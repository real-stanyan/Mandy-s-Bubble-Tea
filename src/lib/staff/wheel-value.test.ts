import { describe, it, expect } from "vitest";
import { MAX_WHOLE, fromParts, toParts } from "./wheel-value";

describe("toParts", () => {
  it("keeps an uncounted item uncounted", () => {
    // The difference between "nobody looked" and "there are none" is the whole
    // point of the missing-items list in the report.
    expect(toParts("")).toBeNull();
    expect(toParts("   ")).toBeNull();
  });

  it("splits whole numbers and fractions the way the sheet writes them", () => {
    expect(toParts("3")).toEqual({ whole: 3, tenth: 0 });
    expect(toParts("0.3")).toEqual({ whole: 0, tenth: 3 });
    expect(toParts("12.5")).toEqual({ whole: 12, tenth: 5 });
  });

  it("survives float noise instead of rounding down", () => {
    expect(toParts("0.29999999999")).toEqual({ whole: 0, tenth: 3 });
    expect(toParts("1.96")).toEqual({ whole: 2, tenth: 0 });
  });

  it("rejects junk and negatives rather than guessing", () => {
    expect(toParts("abc")).toBeNull();
    expect(toParts("-2")).toBeNull();
  });

  it("clamps above the top of the drum", () => {
    expect(toParts("500")).toEqual({ whole: MAX_WHOLE, tenth: 9 });
  });
});

describe("fromParts", () => {
  it("writes whole numbers without a trailing .0", () => {
    expect(fromParts({ whole: 3, tenth: 0 })).toBe("3");
    expect(fromParts({ whole: 0, tenth: 0 })).toBe("0");
  });

  it("writes one decimal place when there is one", () => {
    expect(fromParts({ whole: 0, tenth: 5 })).toBe("0.5");
    expect(fromParts({ whole: 12, tenth: 3 })).toBe("12.3");
  });

  it("clamps out-of-range parts", () => {
    expect(fromParts({ whole: -1, tenth: -1 })).toBe("0");
    expect(fromParts({ whole: 1000, tenth: 99 })).toBe("99.9");
  });

  it("round-trips every value the drums can produce", () => {
    for (let w = 0; w <= MAX_WHOLE; w++) {
      for (let t = 0; t <= 9; t++) {
        expect(toParts(fromParts({ whole: w, tenth: t }))).toEqual({ whole: w, tenth: t });
      }
    }
  });
});
