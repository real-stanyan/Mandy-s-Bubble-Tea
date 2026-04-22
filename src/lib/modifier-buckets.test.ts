// src/lib/modifier-buckets.test.ts
import { describe, it, expect } from "vitest";
import {
  bucketForModifierList,
  MODIFIER_LIST_BUCKETS,
} from "./modifier-buckets";

describe("bucketForModifierList", () => {
  it("returns the mapped bucket for every entry in MODIFIER_LIST_BUCKETS", () => {
    for (const [id, bucket] of Object.entries(MODIFIER_LIST_BUCKETS)) {
      expect(bucketForModifierList(id)).toBe(bucket);
    }
  });
  it("falls back to topping for unknown list ids", () => {
    expect(bucketForModifierList("unknown-list-xyz")).toBe("topping");
  });
  it("falls back to topping for null/undefined", () => {
    expect(bucketForModifierList(null)).toBe("topping");
    expect(bucketForModifierList(undefined)).toBe("topping");
  });
});
