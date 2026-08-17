import { describe, it, expect, vi } from "vitest";

vi.mock("./supabase-server", () => ({ getSupabaseAdmin: vi.fn() }));

import {
  MYSTERY_ODDS,
  drawMysteryPrize,
  prizeLabel,
  COUPON_LIFETIME_DAYS,
} from "./mystery-box";

describe("MYSTERY_ODDS — Stan's table, pinned", () => {
  it("weights sum to exactly 100", () => {
    expect(MYSTERY_ODDS.reduce((s, o) => s + o.weight, 0)).toBe(100);
  });

  it("carries the five prizes at the agreed weights", () => {
    const byPrize = Object.fromEntries(MYSTERY_ODDS.map((o) => [o.prize, o.weight]));
    expect(byPrize).toEqual({
      pct5: 40,
      pct10: 20,
      pct15: 10,
      free_topping: 25,
      free_drink: 5,
    });
  });
});

describe("drawMysteryPrize — the roll maps to the bands", () => {
  it("walks the cumulative bands in table order", () => {
    // Bands (out of 100): pct5 [0,40) · pct10 [40,60) · pct15 [60,70) ·
    // free_topping [70,95) · free_drink [95,100).
    expect(drawMysteryPrize(0)).toBe("pct5");
    expect(drawMysteryPrize(0.3999)).toBe("pct5");
    expect(drawMysteryPrize(0.4)).toBe("pct10");
    expect(drawMysteryPrize(0.5999)).toBe("pct10");
    expect(drawMysteryPrize(0.6)).toBe("pct15");
    expect(drawMysteryPrize(0.6999)).toBe("pct15");
    expect(drawMysteryPrize(0.7)).toBe("free_topping");
    expect(drawMysteryPrize(0.9499)).toBe("free_topping");
    expect(drawMysteryPrize(0.95)).toBe("free_drink");
    expect(drawMysteryPrize(0.9999)).toBe("free_drink");
  });

  it("empirical sanity: 10k rolls land near the table", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 10_000; i++) {
      const p = drawMysteryPrize(i / 10_000);
      counts[p] = (counts[p] ?? 0) + 1;
    }
    expect(counts.pct5).toBe(4000);
    expect(counts.free_drink).toBe(500);
  });
});

describe("labels and lifetime", () => {
  it("every prize has a customer-facing name", () => {
    for (const o of MYSTERY_ODDS) expect(prizeLabel(o.prize)).toBeTruthy();
  });

  it("lifetime is the documented assumption", () => {
    expect(COUPON_LIFETIME_DAYS).toBe(14);
  });
});

describe("normalizeMysteryCode", () => {
  it("ignores case and surrounding space — no pedantry on an IG code", async () => {
    const { normalizeMysteryCode } = await import("./mystery-box");
    expect(normalizeMysteryCode("  TaroStar  ")).toBe("tarostar");
    expect(normalizeMysteryCode("芋头星人")).toBe("芋头星人");
    expect(normalizeMysteryCode("   ")).toBe("");
  });
});
