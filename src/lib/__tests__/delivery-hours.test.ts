import { describe, it, expect } from "vitest";
import { isDeliveryHoursOpen } from "../delivery-hours";

// Helper: build a Date from Brisbane wall-clock (UTC+10).
function brisbane(ymd: string, hh = 12, mm = 0): Date {
  return new Date(`${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+10:00`);
}

describe("isDeliveryHoursOpen", () => {
  it("false at 10:59 Brisbane (before open)", () => {
    expect(isDeliveryHoursOpen(brisbane("2026-04-26", 10, 59))).toBe(false);
  });

  it("true at 11:00 Brisbane (open boundary)", () => {
    expect(isDeliveryHoursOpen(brisbane("2026-04-26", 11, 0))).toBe(true);
  });

  it("true at 21:29 Brisbane (just before close)", () => {
    expect(isDeliveryHoursOpen(brisbane("2026-04-26", 21, 29))).toBe(true);
  });

  it("false at 21:30 Brisbane (close boundary, exclusive)", () => {
    expect(isDeliveryHoursOpen(brisbane("2026-04-26", 21, 30))).toBe(false);
  });

  it("false at 21:31 Brisbane", () => {
    expect(isDeliveryHoursOpen(brisbane("2026-04-26", 21, 31))).toBe(false);
  });

  it("handles UTC-day-boundary: Brisbane 11:30 = UTC 01:30", () => {
    // 2026-04-26 01:30 UTC = 2026-04-26 11:30 Brisbane
    const utc = new Date("2026-04-26T01:30:00Z");
    expect(isDeliveryHoursOpen(utc)).toBe(true);
  });

  it("handles late-night UTC same as Brisbane next day: 13:00 UTC = 23:00 Brisbane", () => {
    // 23:00 Brisbane is past 21:30 close
    const utc = new Date("2026-04-26T13:00:00Z");
    expect(isDeliveryHoursOpen(utc)).toBe(false);
  });
});
