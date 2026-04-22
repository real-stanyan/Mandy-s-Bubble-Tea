// src/lib/sticker-number.test.ts
import { describe, it, expect } from "vitest";
import { encodeStoreStickerNumber } from "./sticker-number";

describe("encodeStoreStickerNumber", () => {
  const cases: Array<[number, string]> = [
    [0, "TA00"],
    [1, "TA01"],
    [9, "TA09"],
    [47, "TA47"],
    [99, "TA99"],
    [100, "TA00*"],
    [147, "TA47*"],
    [199, "TA99*"],
    [200, "TA00**"],
    [900, "TA00*********"],
    [947, "TA47*********"],
    [999, "TA99*********"],
    [1000, "TA00$"],
    [1047, "TA47$"],
    [1100, "TA00$*"],
    [1247, "TA47$**"],
    [1999, "TA99$*********"],
    [2000, "TA00$$"],
    [2347, "TA47$$***"],
    [9999, "TA99$$$$$$$$$*********"],
  ];
  for (const [n, expected] of cases) {
    it(`encodes ${n} -> ${expected}`, () => {
      expect(encodeStoreStickerNumber(n)).toBe(expected);
    });
  }
  it("rejects negative input", () => {
    expect(() => encodeStoreStickerNumber(-1)).toThrow();
  });
  it("rejects non-integer input", () => {
    expect(() => encodeStoreStickerNumber(1.5)).toThrow();
  });
});
