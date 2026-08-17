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

describe("buildStoreDigest — the RIGHT NOW line and the no-scheduling facts", () => {
  /** A Date at the given Brisbane wall-clock time (UTC+10, no DST). */
  const brisbane = (h: number, m: number) => new Date(Date.UTC(2026, 7, 17, h - 10, m));

  it("says CLOSED at 3:47am and forbids taking an order for later", () => {
    // Probe 2026-08-17 03:47: "现在开门吗？我想现在下单" got the opening
    // hours and "想喝点什么" — hours alone make the reader do the clock math.
    const digest = buildStoreDigest(null, brisbane(3, 47));
    expect(digest).toContain("RIGHT NOW the store is CLOSED");
    expect(digest).toContain("CANNOT place an order at this moment");
  });

  it("says OPEN mid-afternoon", () => {
    const digest = buildStoreDigest(null, brisbane(15, 0));
    expect(digest).toContain("RIGHT NOW the store is OPEN");
  });

  it("tells an APP customer the picker lives on the website, not their screen", () => {
    // The picker shipped web-first (App issue #276). "Choose a time at
    // checkout" would send an app customer hunting for a control that
    // isn't there — the same promise-what-we-can't-keep failure the
    // delivery-pause facts exist to prevent.
    const digest = buildStoreDigest(null, new Date(), "app");
    expect(digest).toMatch(/not in this app yet/);
    expect(digest).toMatch(/never tell an app customer to pick a time at checkout/);
    // And the bulk flow must not send them to a checkout time picker either.
    expect(digest).not.toContain("they choose the pickup time on the checkout page");
  });

  it("offers the pickup window and still refuses anything beyond it", () => {
    // The digest used to deny scheduling outright, because nothing could
    // honour it (probe 2026-08-17: "能预约明天下午3点取吗" was answered with
    // an invented checkout time picker). The window now exists — but it
    // stops at 30 minutes, and "tomorrow 3pm" must still be refused.
    const digest = buildStoreDigest();
    expect(digest).toContain("10 / 15 / 20 / 30 minutes");
    expect(digest).toMatch(/NO booking for later today, tomorrow/);
    expect(digest).toContain("Delivery orders cannot be scheduled");
  });

  it("states the online payment methods", () => {
    const digest = buildStoreDigest();
    expect(digest).toContain("card or Apple Pay");
  });

  it("carries the bulk-order brackets and the over-50 handoff", () => {
    const digest = buildStoreDigest();
    expect(digest).toContain("10-19 cups 10% off");
    expect(digest).toContain("20-29 cups 15% off");
    expect(digest).toContain("30-50 cups 20% off");
    expect(digest).toContain("Over 50 cups");
    expect(digest).toContain("record_bulk_inquiry");
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

describe("buildStoreDigest — the mystery box's two rounds", () => {
  it("launch round: tells the model to hand out a box on a bare ask", () => {
    const digest = buildStoreDigest(null, new Date(), "web", true);
    expect(digest).toContain("OPEN TO EVERYONE right now");
    expect(digest).toContain("no code");
    // The code hunt must not be mentioned while it isn't in force — that's
    // how you send launch-week customers looking for a code that doesn't
    // exist (Stan, 2026-08-17).
    expect(digest).not.toMatch(/check the latest posts for the current code/);
  });

  it("code round: the Instagram hunt, and no box without a code", () => {
    const digest = buildStoreDigest(null, new Date(), "web", false);
    expect(digest).toContain("SECRET CODE");
    expect(digest).toContain("never offer a box without a code");
    expect(digest).not.toContain("OPEN TO EVERYONE");
  });
});
