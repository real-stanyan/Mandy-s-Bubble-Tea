import { describe, it, expect, vi, beforeEach } from "vitest";

const ledger = vi.hoisted(() => ({
  rows: { print_jobs: [] as string[], cup_label_jobs: [] as string[] },
  fail: false,
  queried: [] as { table: string; ids: string[] }[],
}));

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      select: () => ({
        in: async (_col: string, ids: string[]) => {
          ledger.queried.push({ table, ids });
          if (ledger.fail) return { data: null, error: new Error("boom") };
          const have = ledger.rows[table as keyof typeof ledger.rows] ?? [];
          return {
            data: have.filter((id) => ids.includes(id)).map((id) => ({ square_order_id: id })),
            error: null,
          };
        },
      }),
    }),
  }),
}));

import {
  isUnpaidCheckout,
  isZeroOpenPickupOrder,
  findGhostZeroOrderIds,
  isGhostZeroOrder,
} from "./ghost-zero-order";

const zeroOpen = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  state: "OPEN",
  totalMoney: { amount: 0n },
  netAmountDueMoney: { amount: 0n },
  tenders: [],
  metadata: { source: "app" },
  fulfillments: [{ type: "PICKUP" }],
  ...extra,
});

describe("isUnpaidCheckout", () => {
  it("walked-away pay sheet: due > 0, no tender", () => {
    expect(isUnpaidCheckout({ totalMoney: { amount: 2573n }, netAmountDueMoney: { amount: 2573n }, tenders: [] })).toBe(true);
  });
  it("every attempt declined: due > 0, only FAILED/VOIDED tenders", () => {
    expect(
      isUnpaidCheckout({
        totalMoney: { amount: 1400n },
        netAmountDueMoney: { amount: 1400n },
        tenders: [{ cardDetails: { status: "FAILED" } }, { cardDetails: { status: "VOIDED" } }],
      }),
    ).toBe(true);
  });
  it("delivery hold (AUTHORIZED) is money on the hook — not unpaid", () => {
    expect(
      isUnpaidCheckout({
        totalMoney: { amount: 2573n },
        netAmountDueMoney: { amount: 2573n },
        tenders: [{ cardDetails: { status: "AUTHORIZED" } }],
      }),
    ).toBe(false);
  });
  it("$0 order owes nothing — not unpaid", () => {
    expect(isUnpaidCheckout(zeroOpen("z"))).toBe(false);
  });
  it("falls back to totalMoney when netAmountDueMoney is absent", () => {
    expect(isUnpaidCheckout({ totalMoney: { amount: 600n }, tenders: [] })).toBe(true);
  });
});

describe("isZeroOpenPickupOrder", () => {
  it("matches the settled-or-ghost $0 pickup shape", () => {
    expect(isZeroOpenPickupOrder(zeroOpen("a"))).toBe(true);
    expect(isZeroOpenPickupOrder(zeroOpen("w", { metadata: { source: "web" } }))).toBe(true);
  });
  it("excludes delivery ($0 delivery stays OPEN/unprinted until a driver accepts)", () => {
    expect(isZeroOpenPickupOrder(zeroOpen("d", { metadata: { source: "app", fulfillment_type: "DELIVERY" } }))).toBe(false);
    expect(isZeroOpenPickupOrder(zeroOpen("d2", { fulfillments: [{ type: "DELIVERY" }] }))).toBe(false);
  });
  it("excludes COMPLETED, tendered and owing orders", () => {
    expect(isZeroOpenPickupOrder(zeroOpen("c", { state: "COMPLETED" }))).toBe(false);
    expect(isZeroOpenPickupOrder(zeroOpen("t", { tenders: [{ id: "t1" }] }))).toBe(false);
    expect(isZeroOpenPickupOrder(zeroOpen("o", { netAmountDueMoney: { amount: 500n } }))).toBe(false);
  });

  // The counter, not us. Ticket "4" (20/08/2026) was a real in-store loyalty
  // redemption: staff applied the reward, made the Honey Black Tea, and never
  // closed the ticket. We never print those, so an absent ledger row proves
  // nothing — treating it as a ghost would refund a star for a drink already
  // handed over.
  it("excludes in-store POS orders even when they carry a loyalty reward", () => {
    expect(
      isZeroOpenPickupOrder(
        zeroOpen("pos", { metadata: {}, fulfillments: [{ type: "IN_STORE" }] }),
      ),
    ).toBe(false);
  });
  it("excludes an order with no source metadata (POS) or a foreign source", () => {
    expect(isZeroOpenPickupOrder(zeroOpen("nosrc", { metadata: {} }))).toBe(false);
    expect(isZeroOpenPickupOrder(zeroOpen("other", { metadata: { source: "kiosk" } }))).toBe(false);
  });
  it("excludes an IN_STORE fulfillment even if something stamped a source", () => {
    expect(
      isZeroOpenPickupOrder(
        zeroOpen("odd", { metadata: { source: "app" }, fulfillments: [{ type: "IN_STORE" }] }),
      ),
    ).toBe(false);
  });
});

describe("findGhostZeroOrderIds", () => {
  beforeEach(() => {
    ledger.rows.print_jobs = [];
    ledger.rows.cup_label_jobs = [];
    ledger.fail = false;
    ledger.queried.length = 0;
  });

  it("a $0 OPEN pickup with no ledger row anywhere is a ghost; a row in either ledger settles it", async () => {
    ledger.rows.print_jobs = ["ok-pj"];
    ledger.rows.cup_label_jobs = ["ok-cl"];
    const ghosts = await findGhostZeroOrderIds([
      zeroOpen("ghost"),
      zeroOpen("ok-pj"),
      zeroOpen("ok-cl"),
      zeroOpen("deliv", { metadata: { fulfillment_type: "DELIVERY" } }),
      { id: "paid", state: "OPEN", totalMoney: { amount: 1500n }, netAmountDueMoney: { amount: 0n }, tenders: [{ id: "t" }] },
    ]);
    expect([...ghosts]).toEqual(["ghost"]);
    // Only the ambiguous shape is looked up, once per ledger.
    expect(ledger.queried.map((q) => q.table).sort()).toEqual(["cup_label_jobs", "print_jobs"]);
    for (const q of ledger.queried) expect(q.ids).toEqual(["ghost", "ok-pj", "ok-cl"]);
  });

  it("no candidates → no round-trip", async () => {
    const ghosts = await findGhostZeroOrderIds([
      { id: "paid", state: "COMPLETED", totalMoney: { amount: 900n }, netAmountDueMoney: { amount: 0n }, tenders: [{ id: "t" }] },
    ]);
    expect(ghosts.size).toBe(0);
    expect(ledger.queried).toHaveLength(0);
  });

  it("a ledger failure hides nothing (fail-open)", async () => {
    ledger.fail = true;
    const ghosts = await findGhostZeroOrderIds([zeroOpen("ghost")]);
    expect(ghosts.size).toBe(0);
  });

  it("isGhostZeroOrder answers for a single order", async () => {
    ledger.rows.print_jobs = ["settled"];
    expect(await isGhostZeroOrder(zeroOpen("settled"))).toBe(false);
    expect(await isGhostZeroOrder(zeroOpen("ghost"))).toBe(true);
    expect(await isGhostZeroOrder(zeroOpen("open-owing", { netAmountDueMoney: { amount: 700n } }))).toBe(false);
  });
});
