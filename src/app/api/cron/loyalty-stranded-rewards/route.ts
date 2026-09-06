import { NextResponse } from "next/server";
import { squareClient } from "@/lib/square";
import { bearerTokenMatches } from "@/lib/bearer-auth";
import { isGhostZeroOrder } from "@/lib/orders/ghost-zero-order";

export const dynamic = "force-dynamic";

// Sweep ISSUED loyalty rewards stranded on dead orders and release their
// held stars.
//
// The redeem route self-heals the moment the SAME customer tries to redeem
// again (reclaimStrandedRewards) — this cron is the bookkeeping backstop
// for everyone who never retries: their stars stay silently pinned to an
// abandoned checkout, the app shows a balance the redeem route won't honor,
// and the books overstate liabilities. (2026-08-28: redeem ×2 + declined
// card left 18 stars held for hours until released by hand.)
//
// A program-wide rewards search (no loyalty_account_id = every reward in
// the program) with an age floor: young holds belong to checkouts that may
// still be mid-payment, and the redeem-route self-heal covers those. The
// dead-order test matches reclaimStrandedRewards: CANCELED, or unpaid with
// no AUTHORIZED/CAPTURED card tender and no cash tender.
const MIN_AGE_MS = 30 * 60 * 1000;
const MAX_PAGES = 10;

export async function GET(request: Request) {
  // Fail closed when CRON_SECRET is unset (e.g. preview deploy) so the
  // public internet can't trigger Square scans. Constant-time compare.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/loyalty-stranded-rewards] CRON_SECRET not configured");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  if (!bearerTokenMatches(request, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const cutoff = Date.now() - MIN_AGE_MS;
  let scanned = 0;
  let released = 0;
  let cursor: string | undefined;
  let pages = 0;

  try {
    do {
      // No `query` at all = every reward in the program (the SDK's query
      // type requires an account id once present).
      const res = await squareClient.loyalty.rewards.search({
        limit: 30,
        cursor,
      });
      cursor = res.cursor ?? undefined;
      pages += 1;

      for (const reward of res.rewards ?? []) {
        if (reward.status !== "ISSUED" || !reward.id || !reward.orderId) continue;
        const created = reward.createdAt ? Date.parse(reward.createdAt) : NaN;
        if (!Number.isFinite(created) || created > cutoff) continue;
        scanned += 1;
        try {
          const { order } = await squareClient.orders.get({
            orderId: reward.orderId,
          });
          if (!order) continue;
          const total = order.totalMoney?.amount ?? 0n;
          const due = order.netAmountDueMoney?.amount ?? total;
          const liveTender = (order.tenders ?? []).some((t) => {
            const s = t.cardDetails?.status;
            return s === "AUTHORIZED" || s === "CAPTURED" || t.type === "CASH";
          });
          const dead = order.state === "CANCELED" || (due > 0n && !liveTender);
          // Ghost $0 pickup (OL890, 2026-09-06): rewards attached, checkout
          // never finished, nothing printed. Same 30-minute age floor as the
          // rest of this sweep keeps a live $0 checkout out of reach.
          const ghost = !dead && (await isGhostZeroOrder(order));
          if (!dead && !ghost) continue;
          await squareClient.loyalty.rewards.delete({ rewardId: reward.id });
          released += 1;
          console.log(
            `[cron/loyalty-stranded-rewards] released reward=${reward.id} order=${reward.orderId} account=${reward.loyaltyAccountId}`,
          );
        } catch (err) {
          console.error(
            `[cron/loyalty-stranded-rewards] reward=${reward.id} skipped:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    } while (cursor && pages < MAX_PAGES);
  } catch (err) {
    console.error(
      "[cron/loyalty-stranded-rewards] sweep failed:",
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json(
      { ok: false, scanned, released },
      { status: 502 },
    );
  }

  if (released > 0) {
    console.log(
      `[cron/loyalty-stranded-rewards] done: scanned=${scanned} released=${released}`,
    );
  }
  return NextResponse.json({ ok: true, scanned, released });
}
