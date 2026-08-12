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

describe("buildStoreDigest — hours and the delivery flow", () => {
  const digest = buildStoreDigest();

  it("states the store hours and the online cutoff", () => {
    // Mandy knew the delivery window but not when the shop itself opens,
    // so she fell back to "I'm not sure" on a question she should own
    // (Stan, 2026-08-12).
    expect(digest).toContain("10:30am");
    expect(digest).toContain("10:30pm");
    expect(digest).toContain("10:15pm"); // online ordering closes earlier
  });

  it("tells her how a delivery order is actually placed", () => {
    // A customer asked "可以配送到 68 Santa Cruz..." and Mandy tried to work
    // out the postcode, got stuck, and offered the phone number. The address
    // is checkout's job; hers is getting them to the drinks.
    expect(digest).toMatch(/CHECKOUT page/i);
    expect(digest).toMatch(/do not.*map a street address/i);
  });
});
