import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth";
import { getWelcomeDiscountStatus } from "@/lib/supabase";
import {
  findLoyaltyAccountByPhone,
  getActiveProgram,
} from "@/lib/loyalty";

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
      welcomeDiscount: { available: false, percentage: 0 },
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
      welcomeDiscount: { available: false, percentage: 0 },
      starsPerReward,
    });
  }

  const [loyaltyAccount, welcomeDiscount] = await Promise.all([
    findLoyaltyAccountByPhone(user.profile.phone_e164).catch(() => null),
    getWelcomeDiscountStatus(user.profile.square_customer_id),
  ]);

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
    starsPerReward,
  });
}
