import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth";
import { findOrCreateLoyaltyAccount, getActiveProgram } from "@/lib/loyalty";
import { starDrinksForAccount } from "@/lib/loyalty-star-drinks";

// Which drink earned each star of the signed-in customer's current cycle.
// Split out of /api/me on purpose: this costs two extra Square calls
// (events search + orders batch) and the membership card renders fine
// without it — the client fetches it lazily and upgrades stars to cups
// when it lands. Failure shape is `drinks: null`, which the card treats
// as "keep plain stars".

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getAuthedUser(request);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Sign in required" },
      { status: 401 },
    );
  }
  const customerId = user.profile?.square_customer_id;
  const phone = user.profile?.phone_e164;
  if (!customerId || !phone) {
    return NextResponse.json(
      { ok: false, error: "Profile incomplete" },
      { status: 404 },
    );
  }

  try {
    const account = await findOrCreateLoyaltyAccount(customerId, phone);
    const { starsPerReward } = await getActiveProgram();
    const goal = starsPerReward > 0 ? starsPerReward : 1;
    const currentStars = account.balance % goal;
    const drinks = await starDrinksForAccount(account.accountId, currentStars);
    return NextResponse.json({ ok: true, drinks });
  } catch (err) {
    console.error(
      "[star-drinks] route failed:",
      err instanceof Error ? err.message : err,
    );
    // Same shape as attribution failure — the card just keeps its stars.
    return NextResponse.json({ ok: true, drinks: null });
  }
}
