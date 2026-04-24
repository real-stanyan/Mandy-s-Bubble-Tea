import { describe, it, expect } from "vitest";
import { getActivePublicHoliday, isPublicHolidayActive } from "../holiday";

// Helper: build a Date from Brisbane wall-clock (UTC+10).
function brisbane(ymd: string, hh = 12, mm = 0): Date {
  // "2026-04-25 12:00 Brisbane" = "2026-04-25 02:00 UTC"
  return new Date(`${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+10:00`);
}

describe("getActivePublicHoliday", () => {
  it("returns null on a regular weekday", () => {
    expect(getActivePublicHoliday(brisbane("2026-04-24"))).toBeNull();
  });

  it("matches ANZAC Day at 00:00 Brisbane", () => {
    const ph = getActivePublicHoliday(brisbane("2026-04-25", 0, 0));
    expect(ph?.name).toBe("ANZAC Day");
  });

  it("matches ANZAC Day at 23:59 Brisbane", () => {
    const ph = getActivePublicHoliday(brisbane("2026-04-25", 23, 59));
    expect(ph?.name).toBe("ANZAC Day");
  });

  it("returns null before 18:00 on Christmas Eve", () => {
    expect(getActivePublicHoliday(brisbane("2026-12-24", 17, 59))).toBeNull();
  });

  it("matches Christmas Eve at 18:00 Brisbane", () => {
    const ph = getActivePublicHoliday(brisbane("2026-12-24", 18, 0));
    expect(ph?.name).toBe("Christmas Eve");
  });

  it("matches Christmas Eve at 23:30 Brisbane", () => {
    const ph = getActivePublicHoliday(brisbane("2026-12-24", 23, 30));
    expect(ph?.name).toBe("Christmas Eve");
  });

  it("handles UTC-day-boundary edge: Brisbane 00:05 Jan 1 is still NYD", () => {
    // 2025-12-31 14:05 UTC = 2026-01-01 00:05 Brisbane
    const nowUtc = new Date("2025-12-31T14:05:00Z");
    const ph = getActivePublicHoliday(nowUtc);
    expect(ph?.name).toBe("New Year's Day");
  });
});

describe("isPublicHolidayActive", () => {
  it("true on ANZAC Day", () => {
    expect(isPublicHolidayActive(brisbane("2026-04-25", 12))).toBe(true);
  });

  it("false on a regular Friday", () => {
    expect(isPublicHolidayActive(brisbane("2026-04-24", 12))).toBe(false);
  });
});
