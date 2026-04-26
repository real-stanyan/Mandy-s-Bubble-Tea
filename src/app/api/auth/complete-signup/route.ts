import { NextResponse } from "next/server";
import { SquareError } from "square";
import { getAuthedUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import {
  squareClient,
  ensureReferenceId,
  findCustomerByPhone,
} from "@/lib/square";
import { grantWelcomeDiscount, purgeAccount } from "@/lib/supabase";
import { findOrCreateLoyaltyAccount } from "@/lib/loyalty";

// Final step of OAuth / phone sign-in. By the time this is called, the
// caller has a valid Supabase session AND has attached a phone to that
// session (either via Phone OTP sign-in or by linking phone to an
// Apple/Google account). We then:
//
//   1. Find or create a Square customer keyed on phone — existing
//      customers (e.g. legacy in-store shoppers) get linked rather than
//      duplicated.
//   2. Upsert the user_profiles row that glues auth.users → Square
//      customer + phone + name.
//   3. Grant a welcome discount for brand-new Square customers.
//
// Idempotent: calling twice with the same Supabase user just re-reads
// the profile on the second call. Safe to retry from the client.

type Body = {
  firstName?: unknown;
  lastName?: unknown;
  channel?: unknown;
};

export async function POST(request: Request) {
  const user = await getAuthedUser(request);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }
  if (!user.phone) {
    return NextResponse.json(
      { ok: false, error: "Attach a phone number to your account first" },
      { status: 400 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const firstName =
    typeof body.firstName === "string" ? body.firstName.trim() : "";
  const lastName =
    typeof body.lastName === "string" ? body.lastName.trim() : "";
  if (!firstName) {
    return NextResponse.json(
      { ok: false, error: "First name is required" },
      { status: 400 },
    );
  }

  const channelRaw = typeof body.channel === "string" ? body.channel : "";
  const channel: "web" | "app" | null =
    channelRaw === "web" || channelRaw === "app" ? channelRaw : null;
  // channel is optional — older clients (and the RN app pre-release)
  // do not send it. NULL is allowed in DB until Phase 2 migration.

  const e164 = user.phone;

  try {
    // If a profile already exists, confirm the Square customer is
    // still there before returning it. A missing customer (404) means
    // the merchant deleted the record in Dashboard and the
    // customer.deleted webhook hadn't reached us yet — purge the stale
    // Supabase state and fall through to the create path so this
    // returning user gets a brand-new customer + welcome discount.
    const admin = getSupabaseAdmin();
    if (user.profile?.square_customer_id) {
      try {
        await squareClient.customers.get({
          customerId: user.profile.square_customer_id,
        });
        return NextResponse.json({
          ok: true,
          profile: user.profile,
          customerId: user.profile.square_customer_id,
          created: false,
        });
      } catch (err) {
        if (!(err instanceof SquareError) || err.statusCode !== 404) throw err;
        await purgeAccount({
          userId: user.userId,
          customerId: user.profile.square_customer_id,
        });
        // Purge removed the auth user; this request's session is now
        // invalid. Tell the client to re-auth.
        return NextResponse.json(
          {
            ok: false,
            error: "Your account was removed. Please sign in again.",
            code: "account_purged",
          },
          { status: 401 },
        );
      }
    }

    // Link (or create) the Square customer by phone.
    let customerId: string | null = null;
    let customerCreated = false;
    const existing = await findCustomerByPhone(e164);
    if (existing?.id) {
      customerId = existing.id;
      await ensureReferenceId(existing.id, existing.referenceId, e164);
    } else {
      const created = await squareClient.customers.create({
        givenName: firstName,
        familyName: lastName || undefined,
        phoneNumber: e164,
        emailAddress: user.email ?? undefined,
        referenceId: e164,
      });
      customerId = created.customer?.id ?? null;
      customerCreated = !!customerId;
    }

    if (!customerId) {
      return NextResponse.json(
        { ok: false, error: "Could not resolve a Square customer" },
        { status: 502 },
      );
    }

    // Stamp square_verified_at on write. Either we just created the
    // Square customer (it exists by definition) or we just linked an
    // existing one we retrieved from Square — both imply the customer
    // is live right now. Skip the first /api/me Square round-trip.
    const { data: upserted, error: upsertErr } = await admin
      .from("user_profiles")
      .upsert(
        {
          user_id: user.userId,
          square_customer_id: customerId,
          phone_e164: e164,
          first_name: firstName,
          last_name: lastName || null,
          square_verified_at: new Date().toISOString(),
          signup_channel: channel,
        },
        { onConflict: "user_id" },
      )
      .select(
        "user_id, square_customer_id, phone_e164, first_name, last_name, square_verified_at, signup_channel",
      )
      .single();
    if (upsertErr) throw upsertErr;

    // Always attempt to grant the welcome discount. grantWelcomeDiscount
    // is idempotent via upsert(onConflict, ignoreDuplicates), so existing
    // welcome rows are left untouched. Previously this was gated on
    // customerCreated, but Square has a `creation_source: MERGE` path
    // that auto-creates a customer record before our complete-signup
    // call lands — findCustomerByPhone then hit the MERGE row and
    // customerCreated flipped to false, silently denying welcome to real
    // new web signups (~6 affected users observed 2026-04-24..26).
    // Letting a rare in-store-only customer pick up a welcome on web
    // signup is much cheaper than denying every Squarish edge-case new
    // user their welcome.
    await grantWelcomeDiscount(customerId);

    // Enroll the customer in the Square loyalty program at signup time so
    // the very first POS scan of their member QR earns a star — even if
    // they never place an online order. Best-effort: a Square loyalty
    // outage must not block account creation. findOrCreateLoyaltyAccount
    // is idempotent, so re-running on a returning user is a no-op.
    try {
      await findOrCreateLoyaltyAccount(customerId, e164);
    } catch (loyaltyErr) {
      console.error(
        "[complete-signup] loyalty enrollment failed:",
        loyaltyErr instanceof Error ? loyaltyErr.message : loyaltyErr,
      );
    }

    return NextResponse.json({
      ok: true,
      profile: upserted,
      customerId,
      created: customerCreated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 502 },
    );
  }
}
