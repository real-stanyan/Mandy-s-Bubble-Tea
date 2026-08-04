import { describe, it, expect } from "vitest";
import { dateOf, shiftWeek, weekKeyFor, weekLabel } from "./week";

describe("week keys", () => {
  it("keys a week by its Monday", () => {
    // 2026-08-04 is a Tuesday; its week starts Monday 2026-08-03.
    expect(weekKeyFor(new Date("2026-08-04T10:00:00Z"))).toBe("2026-08-03");
    expect(weekKeyFor(new Date("2026-08-03T10:00:00Z"))).toBe("2026-08-03");
  });

  it("treats Sunday as the end of its week, not the start", () => {
    // 2026-08-09 is a Sunday — the last day of the week beginning 08-03.
    expect(weekKeyFor(new Date("2026-08-09T02:00:00Z"))).toBe("2026-08-03");
    // Monday the 10th starts the next one.
    expect(weekKeyFor(new Date("2026-08-10T02:00:00Z"))).toBe("2026-08-10");
  });

  it("reads the date in shop time, not the viewer's", () => {
    // 2026-08-09T15:00Z is Sunday in UTC but already Monday 01:00 in
    // Brisbane, so it belongs to the following week.
    expect(weekKeyFor(new Date("2026-08-09T15:00:00Z"))).toBe("2026-08-10");
  });

  it("steps whole weeks", () => {
    expect(shiftWeek("2026-08-03", 1)).toBe("2026-08-10");
    expect(shiftWeek("2026-08-03", -1)).toBe("2026-07-27");
  });

  it("labels a week the way the existing sheet does", () => {
    // The reference spreadsheet is headed `27/07-2/08`.
    expect(weekLabel("2026-07-27")).toBe("27/07-02/08");
    expect(weekLabel("2026-08-03")).toBe("03/08-09/08");
  });

  it("maps weekdays to the right dates", () => {
    expect(dateOf("2026-08-03", "mon").toISOString().slice(0, 10)).toBe("2026-08-03");
    expect(dateOf("2026-08-03", "sun").toISOString().slice(0, 10)).toBe("2026-08-09");
  });
});
