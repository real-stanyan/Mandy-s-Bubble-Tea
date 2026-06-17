import { NextResponse } from "next/server";
import { squareClient } from "@/lib/square";
import { serializeSquareResponse } from "@/lib/utils";
import { findLoyaltyAccountByPhone } from "@/lib/loyalty";
import { getAuthedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Loyalty event log for the account page. Returns the most recent
// events (newest first) for the signed-in user's loyalty account,
// paginating Square's 30-per-page cursor up to MAX_EVENTS so heavy
// accounts see their full history instead of just the latest page.
// Account id is resolved server-side from the phone on the user's
// profile — callers can't peek at someone else's events by guessing an
// accountId.

// Square returns at most 30 events per page; cap total to keep the
// payload and the account-page list bounded.
const MAX_EVENTS = 100;

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

    const raw: NonNullable<
      Awaited<
        ReturnType<typeof squareClient.loyalty.searchEvents>
      >["events"]
    > = [];
    let cursor: string | undefined;
    do {
      const response = await squareClient.loyalty.searchEvents({
        query: {
          filter: {
            loyaltyAccountFilter: { loyaltyAccountId: account.accountId },
          },
        },
        limit: 30,
        cursor,
      });
      raw.push(...(response.events ?? []));
      cursor = response.cursor ?? undefined;
    } while (cursor && raw.length < MAX_EVENTS);

    const events = raw.slice(0, MAX_EVENTS).map((e) => ({
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
