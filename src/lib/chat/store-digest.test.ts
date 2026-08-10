import { describe, it, expect } from "vitest";
import { buildStoreDigest } from "./store-digest";
import { BUSINESS, DELIVERABLE_POSTCODES } from "@/lib/constants";
import { WEEKLY_SPECIALS } from "@/lib/menu/weekly-specials";

describe("buildStoreDigest", () => {
  const digest = buildStoreDigest();

  it("carries the store identity and every deliverable postcode", () => {
    expect(digest).toContain(BUSINESS.address);
    expect(digest).toContain(BUSINESS.phone);
    for (const pc of DELIVERABLE_POSTCODES) expect(digest).toContain(pc);
  });

  it("lists the current weekly specials by name", () => {
    for (const s of WEEKLY_SPECIALS) expect(digest).toContain(s.name);
  });

  it("renders decimal hours as clock labels", () => {
    // DELIVERY.hoursOpen is 10.5 — a raw "10.5" in the prompt invites the
    // model to read it as a price or repeat it verbatim to the customer.
    expect(digest).toContain("10:30");
    expect(digest).toContain("22:30");
    expect(digest).not.toContain("10.5");
  });

  it("states no dollar amounts — prices only ever come from the catalog", () => {
    expect(digest).not.toMatch(/\$\s*\d/);
  });
});
