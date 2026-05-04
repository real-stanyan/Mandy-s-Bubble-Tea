import { describe, expect, it } from "vitest";
import { rollWeighted, makeSeededRandom } from "./random";
import type { PrizePool } from "./types";

const POOL: PrizePool = [
  { tier_id: "a", weight: 50, type: "thank_you", payload: {} },
  {
    tier_id: "b",
    weight: 25,
    type: "digital",
    payload: { kind: "discount", amount_cents: 300 },
  },
  {
    tier_id: "c",
    weight: 25,
    type: "physical",
    payload: { label: "Sticker" },
  },
];

describe("rollWeighted", () => {
  it("is deterministic given a seeded RNG", () => {
    const rng = makeSeededRandom(42);
    const r1 = rollWeighted(POOL, rng);
    const rng2 = makeSeededRandom(42);
    const r2 = rollWeighted(POOL, rng2);
    expect(r1.tier_id).toBe(r2.tier_id);
  });

  it("respects weights within ±1.5% over 100k samples", () => {
    const rng = makeSeededRandom(123);
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 100_000; i++) {
      const result = rollWeighted(POOL, rng);
      counts[result.tier_id]!++;
    }
    expect(counts.a! / 100_000).toBeGreaterThan(0.485);
    expect(counts.a! / 100_000).toBeLessThan(0.515);
    expect(counts.b! / 100_000).toBeGreaterThan(0.235);
    expect(counts.b! / 100_000).toBeLessThan(0.265);
    expect(counts.c! / 100_000).toBeGreaterThan(0.235);
    expect(counts.c! / 100_000).toBeLessThan(0.265);
  });

  it("throws on empty pool", () => {
    expect(() => rollWeighted([], makeSeededRandom(1))).toThrow(/empty/);
  });

  it("throws on zero total weight", () => {
    expect(() =>
      rollWeighted(
        [{ tier_id: "x", weight: 0, type: "thank_you", payload: {} }],
        makeSeededRandom(1),
      ),
    ).toThrow(/total weight/);
  });

  it("returns the only entry when there's just one", () => {
    const single: PrizePool = [
      { tier_id: "only", weight: 100, type: "thank_you", payload: {} },
    ];
    const result = rollWeighted(single, makeSeededRandom(99));
    expect(result.tier_id).toBe("only");
  });

  it("crypto-backed default RNG produces all tiers over 10k samples", () => {
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 10_000; i++) {
      const result = rollWeighted(POOL); // default crypto RNG
      counts[result.tier_id]!++;
    }
    expect(counts.a).toBeGreaterThan(0);
    expect(counts.b).toBeGreaterThan(0);
    expect(counts.c).toBeGreaterThan(0);
  });
});
