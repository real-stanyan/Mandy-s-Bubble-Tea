import { NextResponse } from "next/server";
import { getAppDownloadDiscountStatus } from "@/lib/app-download-discount";
import { getAuthedUser } from "@/lib/auth";

// Read-only status endpoint. Used by the app to show "you have 20% off your
// first order" and by the cart drawer. Customer is derived from the Supabase
// session; the grant is resolved by the profile's phone_e164 (the same anchor
// the web popup claimed against). Signed-out or phone-less users always see
// `available: false` (never errors).

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getAuthedUser(request);
  const phone = user?.profile?.phone_e164;
  if (!phone) {
    return NextResponse.json({
      ok: true,
      available: false,
      percentage: 0,
      claimedAt: null,
      redeemedAt: null,
    });
  }
  const status = await getAppDownloadDiscountStatus(phone);
  return NextResponse.json({ ok: true, ...status });
}
