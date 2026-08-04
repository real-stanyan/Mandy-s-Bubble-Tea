import { describe, it, expect } from "vitest";
import {
  COMFORTABLE_DAYS,
  allSlots,
  autoSlots,
  comfortableDayShortfall,
  daysWorked,
  maxComfortableDays,
  staffById,
  type WeekAvailability,
} from "./model";
import { autoSchedule } from "./schedule";

function staff(id: string) {
  const s = staffById(id);
  if (!s) throw new Error(id);
  return s;
}

describe("comfortable day capacity", () => {
  const CELINA_IN: WeekAvailability = { celina: { on: ["tue"] } };

  it("bounds each person by the tightest of comfort, availability and units", () => {
    expect(maxComfortableDays(staff("hanna"), CELINA_IN)).toBe(5); // comfort cap
    expect(maxComfortableDays(staff("eugenia"), CELINA_IN)).toBe(4); // Wed-Sat only
    expect(maxComfortableDays(staff("elle"), CELINA_IN)).toBe(1); // Sat only
    // Celina is mid-only at two units, so her allowance is exactly one shift
    // — counting it as two days would overstate what she can cover.
    expect(maxComfortableDays(staff("celina"), CELINA_IN)).toBe(1);
  });

  it("counts nobody who is unavailable this week", () => {
    // Celina before she reports contributes zero, and quoting a capacity she
    // can't supply would understate how short the week actually is.
    expect(maxComfortableDays(staff("celina"), {})).toBe(0);
    expect(comfortableDayShortfall({})).toBe(comfortableDayShortfall(CELINA_IN) + 1);
  });

  it("counts demand as the slots auto fills, not every slot on the grid", () => {
    // 24 slots on the grid, but the three Fri/Sat/Sun second-closer slots
    // are Twinkle's. Counting them as staff demand is what used to force a
    // six-day week: 21 person-days needed against 21 available is a fit.
    expect(allSlots()).toHaveLength(24);
    expect(autoSlots()).toHaveLength(21);
    expect(comfortableDayShortfall(CELINA_IN)).toBe(0);
  });

  it("gives everyone a five-day week when Celina has reported", () => {
    // Reserving Twinkle's slots makes a clean week reachable, and it only
    // works if Celina is actually used — her one mid is what keeps somebody
    // else off a sixth day.
    const ctx = { week: CELINA_IN };
    const { roster, complete } = autoSchedule(ctx);
    expect(complete).toBe(true);
    for (const id of ["hanna", "emily", "karen", "eugenia", "celina", "elle"]) {
      expect(daysWorked(roster, id), `${id} days`).toBeLessThanOrEqual(COMFORTABLE_DAYS);
    }
    expect(daysWorked(roster, "celina")).toBe(1);
  });

  it("keeps six-day weeks to the minimum the shortfall forces", () => {
    // Without Celina the week is one person-day short, so exactly one person
    // has to do six days — and only one.
    const ctx = { week: {} };
    expect(comfortableDayShortfall({})).toBe(1);
    const { roster } = autoSchedule(ctx);
    const over = ["hanna", "emily", "karen", "eugenia", "elle"].filter(
      (id) => daysWorked(roster, id) > COMFORTABLE_DAYS,
    );
    expect(over.length).toBeLessThanOrEqual(1);
  });

  it("never rosters anyone into Twinkle's evening slots", () => {
    for (const week of [CELINA_IN, {}]) {
      const { roster } = autoSchedule({ week });
      expect(roster["fri-close-1"]).toBeUndefined();
      expect(roster["sat-close-1"]).toBeUndefined();
    }
  });
});
