import { NextResponse } from "next/server";
import { squareClient } from "@/lib/square";
import { serializeSquareResponse } from "@/lib/utils";

export const dynamic = "force-dynamic";

// GET — fetch loyalty events for an account (used by the app)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");

  if (!accountId) {
    return NextResponse.json(
      { ok: false, error: "accountId query parameter is required" },
      { status: 400 },
    );
  }

  try {
    const response = await squareClient.loyalty.searchEvents({
      query: {
        filter: {
          loyaltyAccountFilter: { loyaltyAccountId: accountId },
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
