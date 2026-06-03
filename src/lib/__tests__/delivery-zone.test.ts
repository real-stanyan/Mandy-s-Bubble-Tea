import { describe, it, expect } from "vitest";
import { isDeliverablePostcode, extractPostcode } from "../delivery-zone";

describe("isDeliverablePostcode", () => {
  it("accepts every postcode in the delivery zone", () => {
    for (const pc of ["4211", "4214", "4215", "4216", "4217", "4218"]) {
      expect(isDeliverablePostcode(pc)).toBe(true);
    }
  });
  it("rejects postcodes outside the zone", () => {
    expect(isDeliverablePostcode("4000")).toBe(false);
    expect(isDeliverablePostcode("4219")).toBe(false);
    expect(isDeliverablePostcode("2000")).toBe(false);
  });
  it("trims surrounding whitespace before matching", () => {
    expect(isDeliverablePostcode(" 4215 ")).toBe(true);
  });
  it("rejects empty / missing values", () => {
    expect(isDeliverablePostcode("")).toBe(false);
    expect(isDeliverablePostcode(null)).toBe(false);
    expect(isDeliverablePostcode(undefined)).toBe(false);
  });
});

describe("extractPostcode", () => {
  it("pulls the postal_code long_name from Google address_components", () => {
    const components = [
      { long_name: "34", short_name: "34", types: ["street_number"] },
      { long_name: "Davenport Street", short_name: "Davenport St", types: ["route"] },
      { long_name: "Southport", short_name: "Southport", types: ["locality"] },
      { long_name: "4215", short_name: "4215", types: ["postal_code"] },
    ];
    expect(extractPostcode(components)).toBe("4215");
  });
  it("returns null when no postal_code component is present", () => {
    const components = [
      { long_name: "Southport", short_name: "Southport", types: ["locality"] },
    ];
    expect(extractPostcode(components)).toBeNull();
  });
  it("returns null for undefined / empty input", () => {
    expect(extractPostcode(undefined)).toBeNull();
    expect(extractPostcode([])).toBeNull();
  });
});
