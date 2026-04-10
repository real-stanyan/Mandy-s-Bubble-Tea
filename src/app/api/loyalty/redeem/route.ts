import { NextResponse } from "next/server";
import {
  redeemReward,
  getActiveProgram,
  findLoyaltyAccountByPhone,
} from "@/lib/loyalty";
import { normalizeAuPhone } from "@/lib/phone";
import { squareClient } from "@/lib/square";

// Redeems a loyalty reward for a customer. Must be called AFTER the
// order has been created — we pass Square the orderId so it can
// apply the reward's discount to the line items. Without an orderId
// the reward is created in ISSUED state but no money comes off the
// order, which is why earlier versions of this route silently
// charged the customer full price.

type RedeemBody = {
  customerId: string;
  phone: string;
  orderId?: string;
};

function isValidBody(body: unknown): body is RedeemBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Partial<RedeemBody>;
  return (
    typeof b.customerId === "string" &&
    b.customerId.length > 0 &&
    typeof b.phone === "string" &&
    b.phone.length > 0 &&
    (b.orderId === undefined || typeof b.orderId === "string")
   );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
   } catch {
    return NextResponse.json(
       { ok: false, error: "Invalid JSON body" },
       { status: 400 },
      );
   }

  if (!isValidBody(body)) {
    return NextResponse.json(
       { ok: false, error: "Missing customerId or phone" },
       { status: 400 },
      );
   }

  const e164 = normalizeAuPhone(body.phone);
  if (!e164) {
    return NextResponse.json(
       { ok: false, error: "Phone number could not be parsed" },
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
