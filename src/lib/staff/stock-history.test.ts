import { describe, it, expect } from "vitest";
import { brisbaneDate, describeAge } from "./stock-history";

// The "was N" hint is only useful if its age is right. A reading labelled
// "yesterday" that is actually a week old would have staff confirming a number
// that stopped being true days ago.

// 10:00 UTC is 20:00 Brisbane the same calendar day.
const WED = new Date("2026-08-05T10:00:00Z");

describe("brisbaneDate", () => {
  it("uses the shop's calendar day, not UTC's", () => {
    // 15:00 UTC on the 5th is already 01:00 on the 6th in Brisbane — the shop
    // would call a count taken then "the 6th".
    expect(brisbaneDate(new Date("2026-08-05T15:00:00Z"))).toBe("2026-08-06");
    expect(brisbaneDate(WED)).toBe("2026-08-05");
  });
});

describe("describeAge", () => {
  it("names today and yesterday plainly", () => {
    expect(describeAge("2026-08-05", WED)).toBe("earlier today");
    expect(describeAge("2026-08-04", WED)).toBe("yesterday");
  });

  it("uses the weekday within the past week", () => {
    // 2026-08-03 was a Monday.
    expect(describeAge("2026-08-03", WED)).toBe("Mon");
  });

  it("falls back to the date once a weekday is ambiguous", () => {
    // Seven days back, "Wed" would read as today. The date cannot be misread.
    expect(describeAge("2026-07-29", WED)).toBe("2026-07-29");
  });

  it("does not dress up a future or malformed date as recent", () => {
    expect(describeAge("not-a-date", WED)).toBe("not-a-date");
  });
});
