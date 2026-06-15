import { describe, it, expect } from "vitest";
import {
  drawLuckyCatHash,
  RARE_LUCKY_CAT_HASH,
  RARE_LUCKY_CAT_ODDS,
} from "./lucky-cat";

const COMMONS = Array.from({ length: 39 }, (_, i) => `common${i.toString().padStart(2, "0")}`);

describe("drawLuckyCatHash", () => {
  it("is deterministic for the same seed", () => {
    const a = drawLuckyCatHash("ORD1:LINE:0", COMMONS, true);
    const b = drawLuckyCatHash("ORD1:LINE:0", COMMONS, true);
    expect(a).toEqual(b);
  });

  it("returns a hash from the common pool (or the rare one)", () => {
    const { hash } = drawLuckyCatHash("ORD1:LINE:0", COMMONS, true);
    expect(hash === RARE_LUCKY_CAT_HASH || COMMONS.includes(hash!)).toBe(true);
  });

  it("never draws rare when the jackpot cat is absent", () => {
    for (let i = 0; i < 2000; i++) {
      const { hash, isRare } = drawLuckyCatHash(`ORD:${i}:0`, COMMONS, false);
      expect(isRare).toBe(false);
      expect(hash).not.toBe(RARE_LUCKY_CAT_HASH);
      expect(COMMONS).toContain(hash);
    }
  });

  it("flags isRare exactly when the rare hash is returned", () => {
    // Find a seed that lands on rare and confirm the flag tracks it.
    let found = false;
    for (let i = 0; i < 5000 && !found; i++) {
      const d = drawLuckyCatHash(`seed:${i}`, COMMONS, true);
      if (d.hash === RARE_LUCKY_CAT_HASH) {
        expect(d.isRare).toBe(true);
        found = true;
      } else {
        expect(d.isRare).toBe(false);
      }
    }
    expect(found).toBe(true); // rare is reachable
  });

  it(`draws rare at roughly 1/${RARE_LUCKY_CAT_ODDS}`, () => {
    const N = 20000;
    let rare = 0;
    for (let i = 0; i < N; i++) {
      if (drawLuckyCatHash(`o${i}:l:0`, COMMONS, true).isRare) rare++;
    }
    const rate = rare / N;
    const expected = 1 / RARE_LUCKY_CAT_ODDS;
    // Generous band — just guard against an order-of-magnitude error.
    expect(rate).toBeGreaterThan(expected * 0.5);
    expect(rate).toBeLessThan(expected * 1.7);
  });

  it("falls back to rare only when commons is empty", () => {
    expect(drawLuckyCatHash("x:y:0", [], true).hash).toBe(RARE_LUCKY_CAT_HASH);
    expect(drawLuckyCatHash("x:y:0", [], false).hash).toBeNull();
  });

  it("honors a custom odds argument (boss-tunable rate)", () => {
    const N = 20000;
    const rateAt = (odds: number) => {
      let rare = 0;
      for (let i = 0; i < N; i++) {
        if (drawLuckyCatHash(`o${i}:l:0`, COMMONS, true, odds).isRare) rare++;
      }
      return rare / N;
    };
    // Tighter odds (1/10) clearly wins more often than the default (1/100).
    expect(rateAt(10)).toBeGreaterThan(rateAt(100));
    // ~1/10 in a generous band.
    expect(rateAt(10)).toBeGreaterThan(0.05);
    expect(rateAt(10)).toBeLessThan(0.17);
  });

  it("guards malformed odds (≤0 / NaN) by falling back to the default", () => {
    // odds=0 must not throw on `% 0`; falls back to RARE_LUCKY_CAT_ODDS.
    expect(() => drawLuckyCatHash("x:y:0", COMMONS, true, 0)).not.toThrow();
    expect(() => drawLuckyCatHash("x:y:0", COMMONS, true, NaN)).not.toThrow();
    const seed = "x:y:0";
    expect(drawLuckyCatHash(seed, COMMONS, true, 0)).toEqual(
      drawLuckyCatHash(seed, COMMONS, true, RARE_LUCKY_CAT_ODDS),
    );
  });
});
