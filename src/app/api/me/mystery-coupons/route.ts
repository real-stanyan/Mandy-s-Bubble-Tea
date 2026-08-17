import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth";
import { getLiveMysteryCoupons } from "@/lib/mystery-box";

// The signed-in customer's live mystery-box coupons, for the Promotions
// page. Labels and expiry only — ids stay server-side (checkout resolves
// the coupon itself; the client never picks one).

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const user = await getAuthedUser(request);
  const phone = user?.profile?.phone_e164;
  if (!user || !phone) {
    return NextResponse.json({ ok: true, coupons: [] });
  }
  const coupons = await getLiveMysteryCoupons(phone);
  return NextResponse.json(
    {
      ok: true,
      coupons: coupons.map((c) => ({ label: c.label, expiresAt: c.expiresAt })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
