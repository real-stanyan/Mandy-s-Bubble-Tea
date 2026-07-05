import { NextResponse } from "next/server";
import {
  redeemReward,
  getActiveProgram,
  findLoyaltyAccountByPhone,
} from "@/lib/loyalty";
import { squareClient } from "@/lib/square";
import { getAuthedUser } from "@/lib/auth";

const MAX_REWARDS_PER_ORDER = 10;

type RedeemBody = {
  orderId?: string;
  count?: number;
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

  const count = body.count ?? 1;
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_REWARDS_PER_ORDER
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: `count must be an integer between 1 and ${MAX_REWARDS_PER_ORDER} (got ${count})`,
      },
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
    const starsNeeded = starsPerReward * count;

    if (body.orderId) {
      // TOCTOU: the order could be edited between this check and the loop
      // below. Square allows order edits and applies loyalty rewards
      // independently of cup count, so the worst case is N rewards
      // attached to fewer cups (extra rewards yield $0 discount on
      // already-free items). Acceptable — a stricter guarantee would
      // require Square order versioning.
      const preCheck = await squareClient.orders.get({
        orderId: body.orderId,
      });

      // Idempotency guard (App checkout retry, 2026-07): the app's
      // idempotency key reuses the SAME order across Pay retries (e.g.
      // user cancelled the payment sheet, order kept), so this route can
      // be called twice for one order. If the order already carries the
      // requested rewards, answer idempotently with the order's CURRENT
      // total — creating more rewards would double-deduct stars and stack
      // free-drink discounts. This must run BEFORE the balance check:
      // the first redemption already deducted the stars, so a retry
      // would otherwise die on "Not enough stars" and strand checkout.
      const existingRewards = preCheck.order?.rewards ?? [];
      if (existingRewards.length >= count) {
        const amount = preCheck.order?.totalMoney?.amount;
        return NextResponse.json({
          ok: true,
          loyaltyRewardIds: existingRewards.map((r) => r.id),
          // Back-compat for older app binaries that read `loyaltyRewardId`
          loyaltyRewardId: existingRewards[0]?.id,
          // Stars were already deducted by the original redemption —
          // the current balance IS the post-redemption balance.
          remainingBalance: account.balance,
          updatedAmountCents: amount != null ? amount.toString() : null,
        });
      }

      const cupCount = (preCheck.order?.lineItems ?? []).reduce(
        (sum, li) => sum + Number(li.quantity ?? "0"),
        0,
      );
      if (count > cupCount) {
        return NextResponse.json(
          {
            ok: false,
            error: `Cannot redeem ${count} rewards on a ${cupCount}-cup order.`,
          },
          { status: 400 },
        );
      }
    }

    if (account.balance < starsNeeded) {
      return NextResponse.json(
        {
          ok: false,
          error: `Not enough stars — you have ${account.balance}, need ${starsNeeded} for ${count} reward${count > 1 ? "s" : ""}.`,
          balance: account.balance,
          starsPerReward,
        },
        { status: 400 },
      );
    }

    const createdIds: string[] = [];
    let updatedAmountCents: string | null = null;
    try {
      for (let i = 0; i < count; i++) {
        const { loyaltyRewardId } = await redeemReward(
          account.accountId,
          rewardTierId,
          body.orderId,
        );
        createdIds.push(loyaltyRewardId);
      }
      if (body.orderId) {
        const refetched = await squareClient.orders.get({
          orderId: body.orderId,
        });
        const amount = refetched.order?.totalMoney?.amount;
        if (amount != null) updatedAmountCents = amount.toString();
      }
    } catch (err) {
      // Rollback every reward we created. Points return to the account
      // automatically and the order's discount lines vanish.
      const rollbacks = await Promise.allSettled(
        createdIds.map((id) =>
          squareClient.loyalty.rewards.delete({ rewardId: id }),
        ),
      );
      const failedRollbacks = rollbacks
        .map((r, i) => ({ r, id: createdIds[i] }))
        .filter((x) => x.r.status === "rejected");
      if (failedRollbacks.length > 0) {
        console.error("[loyalty-rollback-failed]", {
          rewardIds: failedRollbacks.map((x) => x.id),
          originalError: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }

    return NextResponse.json({
      ok: true,
      loyaltyRewardIds: createdIds,
      // Back-compat for older app binaries that read `loyaltyRewardId`
      loyaltyRewardId: createdIds[0],
      // Computed from the pre-loop balance snapshot. If a concurrent
      // redemption on the same account ran in parallel, the displayed
      // value can be briefly stale until the client refetches; the
      // server-side balance check above prevents over-redemption.
      remainingBalance: account.balance - starsNeeded,
      updatedAmountCents,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
