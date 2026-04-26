import { describe, it, expect } from "vitest";
import { getOrderingStatus } from "./store-status";

// Brisbane is fixed UTC+10 (no DST). Build Date objects from explicit
// `+10:00` ISO strings so the test stays clear about wall-clock intent
// regardless of the host clock.
function brisbane(ymd: string, hh: number, mm: number): Date {
  const hhStr = String(hh).padStart(2, "0");
  const mmStr = String(mm).padStart(2, "0");
  return new Date(`${ymd}T${hhStr}:${mmStr}:00+10:00`);
}

describe("getOrderingStatus", () => {
  it("is closed before 10:30am Brisbane (early morning)", () => {
    expect(getOrderingStatus(brisbane("2026-04-26", 9, 0))).toEqual({
      open: false,
      nextLabel: "Opens 10:30am",
    });
  });

  it("is closed at 10:29am (one minute before open)", () => {
    expect(getOrderingStatus(brisbane("2026-04-26", 10, 29))).toEqual({
      open: false,
      nextLabel: "Opens 10:30am",
    });
  });

  it("is open at 10:30am sharp (open boundary inclusive)", () => {
    expect(getOrderingStatus(brisbane("2026-04-26", 10, 30))).toEqual({
      open: true,
      nextLabel: "until 10:25pm",
    });
  });

  it("is open mid-day", () => {
    expect(getOrderingStatus(brisbane("2026-04-26", 14, 0)).open).toBe(true);
  });

  it("is open at 22:24 (one minute before cutoff)", () => {
    expect(getOrderingStatus(brisbane("2026-04-26", 22, 24)).open).toBe(true);
  });

  it("is closed at 22:25 sharp (cutoff boundary exclusive)", () => {
    expect(getOrderingStatus(brisbane("2026-04-26", 22, 25))).toEqual({
      open: false,
      nextLabel: "Opens 10:30am tomorrow",
    });
  });

  it("is closed late evening (after physical store close)", () => {
    expect(getOrderingStatus(brisbane("2026-04-26", 23, 30))).toEqual({
      open: false,
      nextLabel: "Opens 10:30am tomorrow",
    });
  });

  it("handles UTC date boundary correctly (Brisbane next-day 00:30)", () => {
    // 2026-04-26T14:30:00Z = 2026-04-27T00:30:00+10:00 → before open
    expect(getOrderingStatus(new Date("2026-04-26T14:30:00Z"))).toEqual({
      open: false,
      nextLabel: "Opens 10:30am",
    });
  });
});
