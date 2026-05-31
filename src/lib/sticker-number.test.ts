// src/lib/sticker-number.test.ts
import { describe, it, expect } from "vitest";
import { encodeStoreStickerNumber, looksLikePhoneNumber } from "./sticker-number";

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

describe("looksLikePhoneNumber", () => {
  it("flags raw phone numbers Square POS may put in ticketName", () => {
    expect(looksLikePhoneNumber("+61451519606")).toBe(true); // the live incident
    expect(looksLikePhoneNumber("0451519606")).toBe(true); // local AU format
    expect(looksLikePhoneNumber("+61 451 519 606")).toBe(true); // spaced
    expect(looksLikePhoneNumber("0451-519-606")).toBe(true); // dashed
  });

  it("does NOT flag legitimate ticket / order numbers", () => {
    expect(looksLikePhoneNumber("8")).toBe(false); // POS register ticket
    expect(looksLikePhoneNumber("44")).toBe(false);
    expect(looksLikePhoneNumber("999")).toBe(false);
    expect(looksLikePhoneNumber("OL846")).toBe(false); // our web order number
    expect(looksLikePhoneNumber("TA47")).toBe(false); // our TA counter
    expect(looksLikePhoneNumber("")).toBe(false);
    expect(looksLikePhoneNumber("   ")).toBe(false);
  });
});
