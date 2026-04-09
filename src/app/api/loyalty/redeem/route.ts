import { NextResponse } from "next/server";
import { redeemReward, getActiveProgram, findOrCreateLoyaltyAccount } from "@/lib/loyalty";
import { normalizeAuPhone } from "@/lib/phone";

// Redeems a loyalty reward for a customer. Creates a loyalty reward
// that can be attached to an order via the loyaltyRewardId.

type RedeemBody = {
  customerId: string;
  phone: string;
};

function isValidBody(body: unknown): body is RedeemBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Partial<RedeemBody>;
  return (
    typeof b.customerId === "string" &&
    b.customerId.length > 0 &&
    typeof b.phone === "string" &&
    b.phone.length > 0
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
    // Get the loyalty account
    const account = await findOrCreateLoyaltyAccount(body.customerId, e164);

    // Check if user has enough stars for a reward
    const { starsPerReward, rewardTierId } = await getActiveProgram();
    if (account.balance < starsPerReward) {
      return NextResponse.json(
         {
           ok: false,
           error: "Not enough stars for a reward",
           balance: account.balance,
           starsPerReward,
          },
         { status: 400 },
        );
     }

    // Redeem the reward
    const { loyaltyRewardId } = await redeemReward(account.accountId, rewardTierId);

    return NextResponse.json({
      ok: true,
      loyaltyRewardId,
      remainingBalance: account.balance - starsPerReward,
     });
   } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
   }
}
