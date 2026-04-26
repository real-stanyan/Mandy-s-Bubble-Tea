import { describe, it, expect } from "vitest";
import {
  COMPLAINT_WINDOW_DAYS,
  isWithinComplaintWindow,
  ownsOrder,
  validateComplaintBody,
} from "./order-complaint";

describe("isWithinComplaintWindow", () => {
  const now = new Date("2026-04-26T10:00:00Z");

  it("returns true when closedAt is just now", () => {
    expect(isWithinComplaintWindow(now.toISOString(), now)).toBe(true);
  });

  it("returns true at exactly 6 days 23 hours after close", () => {
    const closed = new Date(now.getTime() - (7 * 24 - 1) * 60 * 60 * 1000);
    expect(isWithinComplaintWindow(closed.toISOString(), now)).toBe(true);
  });

  it("returns false at exactly 7 days + 1 minute after close", () => {
    const closed = new Date(now.getTime() - (7 * 24 * 60 + 1) * 60 * 1000);
    expect(isWithinComplaintWindow(closed.toISOString(), now)).toBe(false);
  });

  it("returns false for null closedAt", () => {
    expect(isWithinComplaintWindow(null, now)).toBe(false);
  });
});

describe("ownsOrder", () => {
  it("returns true when customer ids match", () => {
    expect(ownsOrder("CUST_A", "CUST_A")).toBe(true);
  });

  it("returns false when ids differ", () => {
    expect(ownsOrder("CUST_A", "CUST_B")).toBe(false);
  });

  it("returns false when either side is null", () => {
    expect(ownsOrder(null, "CUST_A")).toBe(false);
    expect(ownsOrder("CUST_A", null)).toBe(false);
    expect(ownsOrder(null, null)).toBe(false);
  });
});

describe("validateComplaintBody", () => {
  it("accepts a 10-char description with no photos", () => {
    const r = validateComplaintBody({ description: "Pearls hard", photoCount: 0 });
    expect(r.ok).toBe(true);
  });

  it("rejects descriptions shorter than 10 chars", () => {
    const r = validateComplaintBody({ description: "too short", photoCount: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("DESCRIPTION_TOO_SHORT");
  });

  it("rejects descriptions longer than 1000 chars", () => {
    const r = validateComplaintBody({ description: "a".repeat(1001), photoCount: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("DESCRIPTION_TOO_LONG");
  });

  it("rejects more than 3 photos", () => {
    const r = validateComplaintBody({ description: "Description here.", photoCount: 4 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TOO_MANY_PHOTOS");
  });

  it("rejects negative photo count (defensive)", () => {
    const r = validateComplaintBody({ description: "Description here.", photoCount: -1 });
    expect(r.ok).toBe(false);
  });
});

export const COMPLAINT_WINDOW_DAYS_FROM_LIB: number = COMPLAINT_WINDOW_DAYS;
