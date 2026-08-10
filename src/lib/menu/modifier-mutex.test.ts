import { describe, it, expect } from "vitest";
import type { ModifierList, ModifierOption } from "@/lib/catalog";
import type { CountMap } from "@/lib/menu/build-cart-line";
import {
  getExclusivePartner,
  isExclusiveModifier,
  isWarmIceModifier,
  someSelectedAcrossLists,
} from "@/lib/menu/modifier-mutex";

function mod(id: string, name: string): ModifierOption {
  return {
    id,
    name,
    priceCents: null,
    ordinal: 0,
    onByDefault: false,
    soldOut: false,
  };
}

const cheeseCream = mod("MOD_CC", "Cheese Cream");
const brulee = mod("MOD_BR", "Brulee");
const pearl = mod("MOD_PEARL", "Pearl");
const warmIce = mod("MOD_WARM", "Warm");
const regularIce = mod("MOD_REG", "Regular Ice");

const creamList: ModifierList = {
  id: "ML_CREAM",
  name: "CREAM",
  minSelected: 0,
  maxSelected: null,
  maxDistinct: null,
  maxPerKind: null,
  modifiers: [cheeseCream, brulee, pearl],
};

const iceList: ModifierList = {
  id: "ML_ICE",
  name: "ICE",
  minSelected: 1,
  maxSelected: 1,
  maxDistinct: null,
  maxPerKind: null,
  modifiers: [warmIce, regularIce],
};

describe("isExclusiveModifier", () => {
  it("matches Cheese Cream and Brulee", () => {
    expect(isExclusiveModifier(cheeseCream)).toBe(true);
    expect(isExclusiveModifier(brulee)).toBe(true);
  });

  it("does not match other modifiers", () => {
    expect(isExclusiveModifier(pearl)).toBe(false);
  });
});

describe("isWarmIceModifier", () => {
  it("matches a modifier literally named warm, case/whitespace-insensitive", () => {
    expect(isWarmIceModifier(warmIce)).toBe(true);
    expect(isWarmIceModifier(mod("x", " WARM  "))).toBe(true);
  });

  it("does not match Regular Ice", () => {
    expect(isWarmIceModifier(regularIce)).toBe(false);
  });
});

describe("someSelectedAcrossLists", () => {
  it("finds a match across multiple lists", () => {
    const counts: CountMap = { ML_CREAM: { MOD_CC: 1 } };
    expect(
      someSelectedAcrossLists(counts, [creamList, iceList], isExclusiveModifier),
    ).toBe(true);
  });

  it("returns false when nothing selected matches the predicate", () => {
    const counts: CountMap = { ML_CREAM: { MOD_PEARL: 1 } };
    expect(
      someSelectedAcrossLists(counts, [creamList, iceList], isExclusiveModifier),
    ).toBe(false);
  });

  it("ignores lists absent from counts and zero-count entries", () => {
    const counts: CountMap = { ML_CREAM: { MOD_CC: 0 } };
    expect(someSelectedAcrossLists({}, [creamList, iceList], isExclusiveModifier)).toBe(
      false,
    );
    expect(
      someSelectedAcrossLists(counts, [creamList, iceList], isExclusiveModifier),
    ).toBe(false);
  });
});

describe("getExclusivePartner", () => {
  it("returns the other exclusive modifier in the same list", () => {
    expect(getExclusivePartner(creamList, "MOD_CC")).toBe("MOD_BR");
    expect(getExclusivePartner(creamList, "MOD_BR")).toBe("MOD_CC");
  });

  it("returns null for a non-exclusive modifier", () => {
    expect(getExclusivePartner(creamList, "MOD_PEARL")).toBeNull();
  });

  it("returns null for an unknown modifier id", () => {
    expect(getExclusivePartner(creamList, "NOPE")).toBeNull();
  });
});
