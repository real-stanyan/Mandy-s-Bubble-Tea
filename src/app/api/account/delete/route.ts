import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth";
import { purgeAccount } from "@/lib/supabase";
import { squareClient } from "@/lib/square";

// Apple App Store compliance (2022-06+): every app with accounts must
// offer in-app account deletion. This is the endpoint the mobile app's
// Account tab hits. The web currently has no equivalent UI — account
// deletion is mobile-only for now, but the endpoint accepts cookie
// sessions too so we can add a web button later without a server change.

export async function POST(request: Request) {
  const authed = await getAuthedUser(request);
  if (!authed) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { userId, profile } = authed;
  const customerId = profile?.square_customer_id ?? null;

  // Square customer delete is best-effort. Orders stay intact (they're a
  // separate entity keyed by id, not a FK to customer). If Square is
  // unreachable or the customer is already gone, log and continue —
  // Supabase is the source of truth for "does this account exist".
  if (customerId) {
    try {
      await squareClient.customers.delete({ customerId });
    } catch (err) {
      console.warn(
        "[account-delete] Square customer delete failed",
        customerId,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // purgeAccount deletes welcome_discounts then auth.users; the auth
  // user deletion cascades to user_profiles and device_push_tokens.
  await purgeAccount({ userId, customerId: customerId ?? undefined });

  return NextResponse.json({ ok: true });
}
