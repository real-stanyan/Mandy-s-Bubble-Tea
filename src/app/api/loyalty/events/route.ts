import { NextResponse } from "next/server";
import { squareClient } from "@/lib/square";
import { serializeSquareResponse } from "@/lib/utils";
import { findLoyaltyAccountByPhone } from "@/lib/loyalty";
import { getAuthedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Loyalty event log for the account page. Returns the 30 most recent
// accumulate/redeem events for the signed-in user's loyalty account.
// Account id is resolved server-side from the phone on the user's
// profile — callers can't peek at someone else's events by guessing an
// accountId.

export async function GET(request: Request) {
  const user = await getAuthedUser(request);
  if (!user?.profile?.phone_e164) {
    return NextResponse.json({ ok: true, events: [] });
  }

  try {
    const account = await findLoyaltyAccountByPhone(user.profile.phone_e164);
    if (!account) {
      return NextResponse.json({ ok: true, events: [] });
    }

    const response = await squareClient.loyalty.searchEvents({
      query: {
        filter: {
          loyaltyAccountFilter: { loyaltyAccountId: account.accountId },
        },
      },
      limit: 30,
    });

    const events = (response.events ?? []).map((e) => ({
      id: e.id,
      type: e.type,
      createdAt: e.createdAt,
      accumulatePoints: e.accumulatePoints
        ? {
            points: Number(e.accumulatePoints.points ?? 0),
            orderId: e.accumulatePoints.orderId,
          }
        : undefined,
      redeemReward: e.redeemReward
        ? { rewardId: e.redeemReward.loyaltyProgramId }
        : undefined,
    }));

    return NextResponse.json(serializeSquareResponse({ ok: true, events }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
