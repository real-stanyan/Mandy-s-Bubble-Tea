import { NextResponse } from "next/server";
import { SquareError } from "square";
import { getAuthedUser } from "@/lib/auth";
import { getWelcomeDiscountStatus, purgeAccount } from "@/lib/supabase";
import { getIgFollowDiscountStatus } from "@/lib/ig-follow-discount";
import { getFlashPromoStatus } from "@/lib/flash-promo";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { squareClient } from "@/lib/square";
import {
  findLoyaltyAccountByPhone,
  findOrCreateLoyaltyAccount,
  getActiveProgram,
} from "@/lib/loyalty";

// How long a successful Square customers.get verdict is trusted before
// we re-check. The customer.deleted webhook is the primary self-heal
// path, so this polling fallback can be coarse — 10 minutes keeps the
// worst-case "stale-but-still-authed" window small without hammering
// Square on every page view.
const SQUARE_VERIFY_TTL_MS = 10 * 60 * 1000;

// Hydration endpoint. One call to learn everything the app UI shell
// needs: whether the visitor is signed in, whether they've completed
// the phone/name step, how many loyalty stars they have, and whether
// they still hold an unused welcome discount.
//
// Order history is fetched separately (/api/orders/history) because
// it's bigger, cached less aggressively, and only needed on the
// Account screen.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getAuthedUser(request);

  // Always include starsPerReward so the UI can render progress bars
  // even for signed-out visitors.
  let starsPerReward = 9;
  try {
    starsPerReward = (await getActiveProgram()).starsPerReward;
  } catch {
    // Non-fatal — fall back to the default.
  }

  if (!user) {
    return NextResponse.json({
      ok: true,
      authed: false,
      profile: null,
      loyalty: null,
      welcomeDiscount: { available: false, percentage: 0, drinksRemaining: 0 },
      igFollowDiscount: { available: false, percentage: 0, drinksRemaining: 0 },
      flashPromo: { available: false, key: null, percentage: 0 },
      starsPerReward,
    });
  }

  if (!user.profile?.square_customer_id || !user.profile?.phone_e164) {
    // Signed in via Supabase but signup not yet completed (no phone
    // linked, or profile row missing). The client treats this as "show
    // the firstName/lastName screen".
    return NextResponse.json({
      ok: true,
      authed: true,
      profile: null,
      email: user.email,
      phone: user.phone,
      loyalty: null,
      welcomeDiscount: { available: false, percentage: 0, drinksRemaining: 0 },
      igFollowDiscount: { available: false, percentage: 0, drinksRemaining: 0 },
      flashPromo: { available: false, key: null, percentage: 0 },
      starsPerReward,
    });
  }

  // Defence-in-depth for Square Dashboard deletions. The customer.deleted
  // webhook is the primary signal, but if it misfires (endpoint down,
  // signature mismatch, retries exhausted) a user's Supabase profile
  // still points at a Square customer that no longer exists. Detect
  // here, purge the Supabase-side state, and hand the client back an
  // unauthed shell so the sign-in UI takes over.
  //
  // Rate-limited by square_verified_at: if we checked recently we trust
  // that verdict and skip the Square round-trip. Webhook delivery
  // makes this safe — deletes are near-instant on the happy path and
  // this TTL only gates the fallback.
  const verifiedAtMs = user.profile.square_verified_at
    ? new Date(user.profile.square_verified_at).getTime()
    : 0;
  const shouldVerify = Date.now() - verifiedAtMs > SQUARE_VERIFY_TTL_MS;

  // Cross-environment safety guard. This verify path fires purgeAccount on a
  // Square 404. On localhost/dev the Square client points at SANDBOX while
  // Supabase is PRODUCTION, so a real account's square_customer_id always
  // 404s in sandbox and purgeAccount would delete that customer's live data.
  // Only run the verify+purge path in production. In dev, trust the profile.
  const isProd = process.env.NODE_ENV === "production";

  if (shouldVerify && isProd) {
    try {
      await squareClient.customers.get({
        customerId: user.profile.square_customer_id,
      });
      // Stamp the verdict so the next N minutes of requests skip this.
      // Must be awaited — Vercel serverless may freeze the lambda the
      // instant NextResponse.json returns, killing any in-flight
      // promises we haven't awaited. A missed stamp means /api/me
      // pays the Square round-trip on every hydration, defeating the
      // whole optimisation.
      const { error: stampErr } = await getSupabaseAdmin()
        .from("user_profiles")
        .update({ square_verified_at: new Date().toISOString() })
        .eq("user_id", user.userId);
      if (stampErr) console.error("[me] stamp verified_at failed", stampErr);
    } catch (err) {
      if (err instanceof SquareError && err.statusCode === 404) {
        await purgeAccount({
          userId: user.userId,
          customerId: user.profile.square_customer_id,
        });
        return NextResponse.json({
          ok: true,
          authed: false,
          profile: null,
          loyalty: null,
          welcomeDiscount: { available: false, percentage: 0, drinksRemaining: 0 },
          igFollowDiscount: { available: false, percentage: 0, drinksRemaining: 0 },
          flashPromo: { available: false, key: null, percentage: 0 },
          starsPerReward,
        });
      }
      // Transient / non-404 Square error: log and carry on with the
      // cached profile so we don't sign people out on blips.
      console.error("[me] Square customer verify failed", err);
    }
  }

  const [initialLoyaltyAccount, welcomeDiscount, igFollowDiscount, flashPromo] =
    await Promise.all([
      findLoyaltyAccountByPhone(user.profile.phone_e164).catch(() => null),
      getWelcomeDiscountStatus(user.profile.square_customer_id),
      getIgFollowDiscountStatus(user.profile.square_customer_id),
      getFlashPromoStatus(user.profile.square_customer_id),
    ]);
  let loyaltyAccount = initialLoyaltyAccount;

  // Self-heal for users who signed up before loyalty enrollment moved
  // into complete-signup. If they never placed an online order, no path
  // would have created their Square loyalty account, so a POS scan of
  // their member QR earns nothing. Enroll them now, best-effort.
  if (!loyaltyAccount) {
    try {
      loyaltyAccount = await findOrCreateLoyaltyAccount(
        user.profile.square_customer_id,
        user.profile.phone_e164,
      );
    } catch (enrollErr) {
      console.error(
        "[me] lazy loyalty enroll failed:",
        enrollErr instanceof Error ? enrollErr.message : enrollErr,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    authed: true,
    profile: user.profile,
    email: user.email,
    phone: user.phone,
    loyalty: loyaltyAccount
      ? {
          accountId: loyaltyAccount.accountId,
          balance: loyaltyAccount.balance,
          lifetimePoints: loyaltyAccount.lifetimePoints,
        }
      : null,
    welcomeDiscount,
    igFollowDiscount: {
      available: igFollowDiscount.available,
      percentage: igFollowDiscount.percentage,
      drinksRemaining: igFollowDiscount.drinksRemaining,
    },
    flashPromo,
    starsPerReward,
  });
}
