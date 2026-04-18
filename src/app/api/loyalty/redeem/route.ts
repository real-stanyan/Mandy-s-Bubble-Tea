import { NextResponse } from "next/server";
import {
  redeemReward,
  getActiveProgram,
  findLoyaltyAccountByPhone,
} from "@/lib/loyalty";
import { squareClient } from "@/lib/square";
import { getAuthedUser } from "@/lib/auth";

// Redeems a loyalty reward for the signed-in user. Must be called
// AFTER the order has been created — we pass Square the orderId so it
// can apply the reward's discount to the line items. Without an orderId
// the reward is created in ISSUED state but no money comes off the
// order.

type RedeemBody = {
  orderId?: string;
};

export async function POST(request: Request) {
  const user = await getAuthedUser(request);
  if (!user?.profile?.phone_e164) {
    return NextResponse.json(
      { ok: false, error: "Sign in to redeem a reward" },
      { status: 401 },
    );
  }
  const e164 = user.profile.phone_e164;

  let body: RedeemBody;
  try {
    body = (await request.json()) as RedeemBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (body.orderId !== undefined && typeof body.orderId !== "string") {
    return NextResponse.json(
      { ok: false, error: "Invalid orderId" },
      { status: 400 },
    );
  }

  try {
    // Lookup only — never create a zero-balance account during a
    // redemption. A silent create would turn a lookup miss into a
    // misleading "Not enough stars" error for a user who really does
    // have stars under a slightly different phone.
    const account = await findLoyaltyAccountByPhone(e164);
    if (!account) {
      return NextResponse.json(
        {
          ok: false,
          error: `No loyalty account found for ${e164}. Place an order first to enroll.`,
        },
        { status: 404 },
      );
    }

    const { starsPerReward, rewardTierId } = await getActiveProgram();
    if (account.balance < starsPerReward) {
      return NextResponse.json(
        {
          ok: false,
          error: `Not enough stars for a reward — you have ${account.balance}, need ${starsPerReward}.`,
          balance: account.balance,
          starsPerReward,
        },
        { status: 400 },
      );
    }

    const { loyaltyRewardId } = await redeemReward(
      account.accountId,
      rewardTierId,
      body.orderId,
    );

    // If an orderId was provided, Square has now applied the reward
    // discount to that order. Re-fetch it so the client can use the
    // updated total for verifyBuyer + payment. Without this the
    // buyer verification amount would reflect the pre-discount
    // price and Square would reject the payment.
    let updatedAmountCents: string | null = null;
    if (body.orderId) {
      const refetched = await squareClient.orders.get({
        orderId: body.orderId,
      });
      const amount = refetched.order?.totalMoney?.amount;
      if (amount != null) {
        updatedAmountCents = amount.toString();
      }
    }

    return NextResponse.json({
      ok: true,
      loyaltyRewardId,
      remainingBalance: account.balance - starsPerReward,
      updatedAmountCents,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
