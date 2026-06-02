import { describe, it, expect } from "vitest";
import { isDeliveryHoursOpen } from "../delivery-hours";

// Helper: build a Date from Brisbane wall-clock (UTC+10).
function brisbane(ymd: string, hh = 12, mm = 0): Date {
  return new Date(`${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+10:00`);
}

describe("isDeliveryHoursOpen", () => {
  it("false at 10:29 Brisbane (before open)", () => {
    expect(isDeliveryHoursOpen(brisbane("2026-04-26", 10, 29))).toBe(false);
  });

  it("true at 10:30 Brisbane (open boundary)", () => {
    expect(isDeliveryHoursOpen(brisbane("2026-04-26", 10, 30))).toBe(true);
  });

  it("true at 22:29 Brisbane (just before close)", () => {
    expect(isDeliveryHoursOpen(brisbane("2026-04-26", 22, 29))).toBe(true);
  });

  it("false at 22:30 Brisbane (close boundary, exclusive)", () => {
    expect(isDeliveryHoursOpen(brisbane("2026-04-26", 22, 30))).toBe(false);
  });

  it("false at 22:31 Brisbane", () => {
    expect(isDeliveryHoursOpen(brisbane("2026-04-26", 22, 31))).toBe(false);
  });

  it("handles UTC-day-boundary: Brisbane 11:00 = UTC 01:00", () => {
    const utc = new Date("2026-04-26T01:00:00Z");
    expect(isDeliveryHoursOpen(utc)).toBe(true);
  });

  it("late-night UTC = Brisbane past close: 13:00 UTC = 23:00 Brisbane", () => {
    // 23:00 Brisbane is past the 22:30 close
    const utc = new Date("2026-04-26T13:00:00Z");
    expect(isDeliveryHoursOpen(utc)).toBe(false);
  });
});
