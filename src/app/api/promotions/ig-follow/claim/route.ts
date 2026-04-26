import { NextResponse } from "next/server";
import { claimIgFollowDiscount } from "@/lib/ig-follow-discount";
import { getAuthedUser } from "@/lib/auth";

// Mint a 10% off ticket for the signed-in customer. Idempotent: a
// duplicate call returns { alreadyClaimed: true } and changes nothing.
// Honor system — the server does not verify Instagram follow status;
// per-customer dedup is the entire defence.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getAuthedUser(request);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Sign in required" },
      { status: 401 },
    );
  }
  const customerId = user.profile?.square_customer_id;
  if (!customerId) {
    return NextResponse.json(
      { ok: false, error: "Profile incomplete" },
      { status: 404 },
    );
  }
  const result = await claimIgFollowDiscount(customerId);
  return NextResponse.json({ ok: true, alreadyClaimed: result.alreadyClaimed });
}
