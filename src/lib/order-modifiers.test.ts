import { describe, it, expect } from "vitest";
import { dedupeLineModifiers } from "./order-modifiers";

describe("dedupeLineModifiers", () => {
  it("collapses duplicate ids into one entry with quantity", () => {
    const result = dedupeLineModifiers([
      { id: "PEARL" },
      { id: "PEARL" },
      { id: "PEARL" },
    ]);
    expect(result).toEqual([{ catalogObjectId: "PEARL", quantity: "3" }]);
  });

  it("omits quantity when only one of a kind (Square default)", () => {
    const result = dedupeLineModifiers([{ id: "PEARL" }]);
    expect(result).toEqual([{ catalogObjectId: "PEARL" }]);
  });

  it("preserves first-seen order across distinct ids", () => {
    const result = dedupeLineModifiers([
      { id: "PEARL" },
      { id: "ALOE" },
      { id: "PEARL" },
      { id: "ICE" },
    ]);
    expect(result).toEqual([
      { catalogObjectId: "PEARL", quantity: "2" },
      { catalogObjectId: "ALOE" },
      { catalogObjectId: "ICE" },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(dedupeLineModifiers([])).toEqual([]);
  });

  it("handles the bug case from production: same topping picked 2 times", () => {
    // Reproduction of the 400 INVALID_VALUE / Duplicate catalog_object_id
    // error: ItemOrderForm flattens count=2 → two entries with same id.
    const flatFromForm = [
      { id: "IORRMSZH4OBDE7BQNRQLCV62" },
      { id: "IORRMSZH4OBDE7BQNRQLCV62" },
    ];
    expect(dedupeLineModifiers(flatFromForm)).toEqual([
      { catalogObjectId: "IORRMSZH4OBDE7BQNRQLCV62", quantity: "2" },
    ]);
  });
});
