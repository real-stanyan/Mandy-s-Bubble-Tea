import { describe, it, expect } from "vitest";
import {
  brisbaneClockLabel,
  pickupClockLabel,
  availablePickupOffsets,
  isValidPickupOffset,
  toScheduledOrderNumber,
  printDueAt,
  MAKE_LEAD_MINUTES,
  printTimingFor,
} from "./pickup-schedule";

/** A Date at the given Brisbane wall-clock time (UTC+10, no DST). */
function brisbane(h: number, m: number): Date {
  return new Date(Date.UTC(2026, 7, 16, h - 10, m));
}

describe("availablePickupOffsets", () => {
  it("offers every pill in the middle of the day", () => {
    expect(availablePickupOffsets(brisbane(15, 0))).toEqual([10, 15, 20, 30]);
  });

  it("drops pills whose pickup would land after close", () => {
    // 10:05pm + 30min = 10:35pm > 10:30pm close — the 30 pill must vanish.
    expect(availablePickupOffsets(brisbane(22, 5))).toEqual([10, 15, 20]);
    // 10:14pm: only 10 and 15 still fit (10:29pm and... 10:29 vs 10:34).
    expect(availablePickupOffsets(brisbane(22, 14))).toEqual([10, 15]);
    // 10:25pm: nothing fits; the customer orders ASAP or not at all.
    expect(availablePickupOffsets(brisbane(22, 25))).toEqual([]);
  });

  it("keeps a pill that lands exactly on close", () => {
    // 10:00pm + 30 = 10:30pm — collecting at the closing minute is allowed.
    expect(availablePickupOffsets(brisbane(22, 0))).toContain(30);
  });
});

describe("isValidPickupOffset", () => {
  it("always accepts ASAP", () => {
    expect(isValidPickupOffset(0, brisbane(22, 29))).toBe(true);
  });

  it("accepts an offered pill and rejects a stale or invented one", () => {
    expect(isValidPickupOffset(15, brisbane(15, 0))).toBe(true);
    // 30 was on screen when the tab loaded at 9:50pm; by 10:05pm it's gone
    // and the server must say no rather than promise a post-close pickup.
    expect(isValidPickupOffset(30, brisbane(22, 5))).toBe(false);
    // Hand-rolled values never validate.
    expect(isValidPickupOffset(7, brisbane(15, 0))).toBe(false);
    expect(isValidPickupOffset(-10, brisbane(15, 0))).toBe(false);
  });
});

describe("toScheduledOrderNumber", () => {
  it("relabels the OL8xx series to OL7xx", () => {
    expect(toScheduledOrderNumber("OL800")).toBe("OL700");
    expect(toScheduledOrderNumber("OL846")).toBe("OL746");
  });

  it("leaves anything else alone", () => {
    // Past 99 orders the counter reads OL900 — wrong prefix beats a
    // mangled number; see the doc comment.
    expect(toScheduledOrderNumber("OL900")).toBe("OL900");
    expect(toScheduledOrderNumber("DE801")).toBe("DE801");
  });
});

describe("printDueAt", () => {
  it("backs off the make lead from the pickup time", () => {
    const pickup = new Date("2026-08-16T06:15:00.000Z");
    const due = printDueAt(pickup);
    expect(pickup.getTime() - due.getTime()).toBe(MAKE_LEAD_MINUTES * 60 * 1000);
  });
});

describe("clock labels — one string, three surfaces", () => {
  it("renders Brisbane wall time in 12-hour form", () => {
    // 5:21pm Brisbane = 07:21 UTC.
    expect(brisbaneClockLabel(new Date("2026-08-17T07:21:00.000Z"))).toBe("5:21pm");
    // Midnight and noon are the am/pm edges 12-hour clocks get wrong.
    expect(brisbaneClockLabel(new Date("2026-08-17T14:00:00.000Z"))).toBe("12:00am");
    expect(brisbaneClockLabel(new Date("2026-08-17T02:00:00.000Z"))).toBe("12:00pm");
  });

  it("labels a pill with the time the customer would actually arrive", () => {
    // The pills print this instead of a bare "10 min", which read as a
    // wait rather than an arrival time (Stan, 2026-08-17).
    const now = new Date("2026-08-17T06:51:00.000Z"); // 4:51pm Brisbane
    expect(pickupClockLabel(10, now)).toBe("5:01pm");
    expect(pickupClockLabel(30, now)).toBe("5:21pm");
  });
});

describe("printTimingFor", () => {
  const now = new Date("2026-08-17T07:00:00Z"); // 5:00pm Brisbane

  it("an ASAP order holds nothing", () => {
    expect(printTimingFor({ scheduleType: "ASAP" }, now)).toEqual({
      printDueAt: null,
      pickupAt: null,
    });
  });

  it("a missing / unknown fulfillment holds nothing", () => {
    expect(printTimingFor(undefined, now).printDueAt).toBeNull();
    expect(printTimingFor(null, now).printDueAt).toBeNull();
    expect(printTimingFor({ scheduleType: "SCHEDULED" }, now).printDueAt).toBeNull();
    expect(
      printTimingFor({ scheduleType: "SOMETHING_NEW", pickupAt: "2026-08-17T07:20:00Z" }, now)
        .printDueAt,
    ).toBeNull();
  });

  it("a scheduled order is due at pickup minus the make lead", () => {
    const timing = printTimingFor(
      { scheduleType: "SCHEDULED", pickupAt: "2026-08-17T07:20:00Z" },
      now,
    );
    expect(timing.pickupAt).toBe("2026-08-17T07:20:00.000Z");
    expect(timing.printDueAt).toBe("2026-08-17T07:15:00.000Z");
    expect(
      new Date(timing.pickupAt!).getTime() - new Date(timing.printDueAt!).getTime(),
    ).toBe(MAKE_LEAD_MINUTES * 60 * 1000);
  });

  it("a pickup already inside the lead window is due now, not in the past", () => {
    // 3 minutes out with a 5-minute lead — the due time would be 2 minutes ago.
    const timing = printTimingFor(
      { scheduleType: "SCHEDULED", pickupAt: "2026-08-17T07:03:00Z" },
      now,
    );
    expect(timing.printDueAt).toBe(now.toISOString());
  });

  it("a backfill of a long-past scheduled order prints immediately", () => {
    const timing = printTimingFor(
      { scheduleType: "SCHEDULED", pickupAt: "2026-08-16T07:20:00Z" },
      now,
    );
    expect(timing.printDueAt).toBe(now.toISOString());
    expect(timing.pickupAt).toBe("2026-08-16T07:20:00.000Z");
  });

  it("an unparseable pickupAt holds nothing rather than throwing", () => {
    expect(printTimingFor({ scheduleType: "SCHEDULED", pickupAt: "nope" }, now)).toEqual({
      printDueAt: null,
      pickupAt: null,
    });
  });
});
