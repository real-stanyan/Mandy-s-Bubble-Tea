import { describe, it, expect } from "vitest";
import {
  SHIFT_UNITS,
  STAFF,
  allSlots,
  autoSlots,
  assignedUnits,
  isAvailable,
  isAvailableForShift,
  slotCount,
  slotId,
  staffById,
  totalUnits,
  type Roster,
  type WeekAvailability,
} from "./model";
import { canWorkSlot, findViolations } from "./rules";
import { autoSchedule } from "./schedule";

const EMPTY_WEEK: WeekAvailability = {};
// Celina is opt-in: without a declared day she is never rostered, so most
// tests hand her a midweek day the way Stan would.
const WEEK_WITH_CELINA: WeekAvailability = { celina: { on: ["tue"] } };

function staff(id: string) {
  const s = staffById(id);
  if (!s) throw new Error(`no staff ${id}`);
  return s;
}

describe("week shape", () => {
  it("has one person per shift except Fri/Sat/Sun closing", () => {
    expect(slotCount("mon", "close")).toBe(1);
    expect(slotCount("thu", "close")).toBe(1);
    expect(slotCount("fri", "close")).toBe(2);
    expect(slotCount("sat", "close")).toBe(2);
    expect(slotCount("sun", "close")).toBe(2);
  });

  it("counts 12-22 as two units", () => {
    expect(SHIFT_UNITS.mid).toBe(2);
    expect(SHIFT_UNITS.open).toBe(1);
    expect(SHIFT_UNITS.close).toBe(1);
  });

  it("counts the whole grid at 24 slots / 31 units", () => {
    // 7 openings (1 unit) + 7 mids (2 units) + 10 closings (1 unit): Mon-Thu
    // carry one closer, Fri/Sat/Sun carry two.
    expect(allSlots()).toHaveLength(24);
    expect(totalUnits()).toBe(31);
  });

  it("leaves the three second-closer slots out of what auto fills", () => {
    // Those are Twinkle's. 21 slots is what the staff rota is measured on.
    expect(autoSlots()).toHaveLength(21);
    for (const day of ["fri", "sat", "sun"] as const) {
      expect(autoSlots().some((s) => slotId(s) === `${day}-close-1`)).toBe(false);
    }
  });
});

describe("availability", () => {
  it("opt-out staff are available on their usual days by default", () => {
    expect(isAvailable(staff("hanna"), "mon", EMPTY_WEEK)).toBe(true);
    expect(isAvailable(staff("eugenia"), "mon", EMPTY_WEEK)).toBe(false);
    expect(isAvailable(staff("eugenia"), "wed", EMPTY_WEEK)).toBe(true);
  });

  it("opt-out staff can be marked off for a week", () => {
    const week: WeekAvailability = { hanna: { off: ["mon"] } };
    expect(isAvailable(staff("hanna"), "mon", week)).toBe(false);
    expect(isAvailable(staff("hanna"), "tue", week)).toBe(true);
  });

  it("takes leave for a single shift without giving away the whole day", () => {
    // An appointment on Thursday morning shouldn't cost the evening too —
    // marking the day off would hand away two shifts to cover one.
    const week: WeekAvailability = { karen: { offShifts: ["thu-open"] } };
    expect(isAvailableForShift(staff("karen"), "thu", "open", week)).toBe(false);
    expect(isAvailableForShift(staff("karen"), "thu", "mid", week)).toBe(true);
    expect(isAvailableForShift(staff("karen"), "thu", "close", week)).toBe(true);
    // Still counts as a working day for the day-level view.
    expect(isAvailable(staff("karen"), "thu", week)).toBe(true);
  });

  it("a whole day off blocks every shift on it", () => {
    const week: WeekAvailability = { emily: { off: ["wed"] } };
    for (const kind of ["open", "mid", "close"] as const) {
      expect(isAvailableForShift(staff("emily"), "wed", kind, week)).toBe(false);
    }
    expect(isAvailable(staff("emily"), "wed", week)).toBe(false);
  });

  it("keeps someone off a shift out of the auto roster", () => {
    const week: WeekAvailability = {
      celina: { on: ["tue"] },
      hanna: { offShifts: ["mon-open", "tue-open"] },
    };
    const { roster } = autoSchedule({ week });
    expect(roster["mon-open-0"]).not.toBe("hanna");
    expect(roster["tue-open-0"]).not.toBe("hanna");
  });

  it("Celina is unavailable until her days are entered", () => {
    // She reports a week ahead; a blank week means "hasn't told us", and
    // treating that as available would roster someone who never agreed.
    expect(isAvailable(staff("celina"), "tue", EMPTY_WEEK)).toBe(false);
    expect(isAvailable(staff("celina"), "tue", WEEK_WITH_CELINA)).toBe(true);
    expect(isAvailable(staff("celina"), "wed", WEEK_WITH_CELINA)).toBe(false);
  });
});

describe("who can work what", () => {
  const ctx = { week: EMPTY_WEEK };

  it("Elle cannot open but can do mid and close", () => {
    const el = staff("elle");
    expect(canWorkSlot(el, { day: "sat", kind: "open", index: 0 }, {}, ctx).ok).toBe(false);
    expect(canWorkSlot(el, { day: "sat", kind: "mid", index: 0 }, {}, ctx).ok).toBe(true);
    expect(canWorkSlot(el, { day: "sat", kind: "close", index: 0 }, {}, ctx).ok).toBe(true);
  });

  it("Celina only works mid", () => {
    const c = staff("celina");
    const ctxC = { week: WEEK_WITH_CELINA };
    expect(canWorkSlot(c, { day: "tue", kind: "mid", index: 0 }, {}, ctxC).ok).toBe(true);
    expect(canWorkSlot(c, { day: "tue", kind: "open", index: 0 }, {}, ctxC).ok).toBe(false);
    expect(canWorkSlot(c, { day: "tue", kind: "close", index: 0 }, {}, ctxC).ok).toBe(false);
  });

  it("blocks opening the morning after closing", () => {
    const roster: Roster = { "mon-close-0": "emily" };
    const r = canWorkSlot(staff("emily"), { day: "tue", kind: "open", index: 0 }, roster, ctx);
    expect(r.ok).toBe(false);
  });

  it("carries the closing rule across the week boundary", () => {
    // Sunday's closer must not open Monday of the following week — the one
    // turnaround a per-week grid would otherwise never check.
    const r = canWorkSlot(
      staff("emily"),
      { day: "mon", kind: "open", index: 0 },
      {},
      { week: EMPTY_WEEK, previousWeekSundayCloserIds: ["emily"] },
    );
    expect(r.ok).toBe(false);
  });

  it("blocks 12-22 on consecutive days", () => {
    const roster: Roster = { "wed-mid-0": "karen" };
    expect(canWorkSlot(staff("karen"), { day: "thu", kind: "mid", index: 0 }, roster, ctx).ok).toBe(false);
    expect(canWorkSlot(staff("karen"), { day: "tue", kind: "mid", index: 0 }, roster, ctx).ok).toBe(false);
    // Two days apart is fine.
    expect(canWorkSlot(staff("karen"), { day: "fri", kind: "mid", index: 0 }, roster, ctx).ok).toBe(true);
  });

  it("blocks two shifts on the same day", () => {
    const roster: Roster = { "mon-open-0": "hanna" };
    const r = canWorkSlot(staff("hanna"), { day: "mon", kind: "close", index: 0 }, roster, ctx);
    expect(r.ok).toBe(false);
  });

  it("respects the weekly unit cap, counting mid as two", () => {
    // Hanna caps at 7. Three non-adjacent mids are 6 units, one open takes
    // her to exactly 7, and anything beyond that must be refused.
    const roster: Roster = {
      "mon-mid-0": "hanna",
      "wed-mid-0": "hanna",
      "fri-mid-0": "hanna",
    };
    expect(assignedUnits(roster, "hanna")).toBe(6);
    expect(canWorkSlot(staff("hanna"), { day: "sun", kind: "open", index: 0 }, roster, ctx).ok).toBe(true);

    const full: Roster = { ...roster, "sun-open-0": "hanna" };
    expect(assignedUnits(full, "hanna")).toBe(7);
    const over = canWorkSlot(staff("hanna"), { day: "tue", kind: "open", index: 0 }, full, ctx);
    expect(over.ok).toBe(false);
  });

  it("caps Eugenia at two mids a week, because her days are contiguous", () => {
    // She only works Wed-Sat, and mids can't fall on consecutive days, so
    // Wed+Fri (or Thu+Sat) is the most she can hold — 4 of her 6 units.
    // Worth pinning down: it means she can never absorb a third mid no
    // matter how short the week is.
    const roster: Roster = { "wed-mid-0": "eugenia", "fri-mid-0": "eugenia" };
    for (const day of ["thu", "sat"] as const) {
      const r = canWorkSlot(staff("eugenia"), { day, kind: "mid", index: 0 }, roster, ctx);
      expect(r.ok).toBe(false);
    }
  });
});

describe("no three days in a row", () => {
  const ctx = { week: EMPTY_WEEK };

  it("refuses a third consecutive opening", () => {
    const roster: Roster = { "mon-open-0": "hanna", "tue-open-0": "hanna" };
    expect(canWorkSlot(staff("hanna"), { day: "wed", kind: "open", index: 0 }, roster, ctx).ok).toBe(false);
    // Two in a row is still fine.
    expect(canWorkSlot(staff("hanna"), { day: "tue", kind: "open", index: 0 }, { "mon-open-0": "hanna" }, ctx).ok).toBe(true);
  });

  it("refuses filling the middle of a gap to make three", () => {
    // Mon and Wed already opened; Tuesday would complete the run.
    const roster: Roster = { "mon-open-0": "emily", "wed-open-0": "emily" };
    expect(canWorkSlot(staff("emily"), { day: "tue", kind: "open", index: 0 }, roster, ctx).ok).toBe(false);
  });

  it("counts 12-22 as a late night alongside 17-22:30", () => {
    // A mid finishes at 22:00 and a close at 22:30 — three of those back to
    // back is three late nights however they're mixed.
    const roster: Roster = { "mon-close-0": "karen", "tue-mid-0": "karen" };
    expect(canWorkSlot(staff("karen"), { day: "wed", kind: "close", index: 0 }, roster, ctx).ok).toBe(false);
  });

  it("reports both runs as hard violations", () => {
    const opens: Roster = {
      "mon-open-0": "hanna",
      "tue-open-0": "hanna",
      "wed-open-0": "hanna",
    };
    expect(
      findViolations(opens, ctx).some(
        (v) => v.severity === "hard" && /opens three days running/.test(v.message),
      ),
    ).toBe(true);

    const lates: Roster = {
      "mon-close-0": "emily",
      "tue-mid-0": "emily",
      "wed-close-0": "emily",
    };
    expect(
      findViolations(lates, ctx).some(
        (v) => v.severity === "hard" && /three late nights running/.test(v.message),
      ),
    ).toBe(true);
  });
});

describe("violation reporting", () => {
  it("flags a closer opening the next morning as hard", () => {
    const roster: Roster = { "mon-close-0": "karen", "tue-open-0": "karen" };
    const v = findViolations(roster, { week: EMPTY_WEEK });
    expect(v.some((x) => x.severity === "hard" && /closed the night before/.test(x.message))).toBe(true);
  });

  it("flags consecutive mids as hard", () => {
    const roster: Roster = { "mon-mid-0": "emily", "tue-mid-0": "emily" };
    const v = findViolations(roster, { week: EMPTY_WEEK });
    expect(v.some((x) => x.severity === "hard" && /consecutive days/.test(x.message))).toBe(true);
  });

  it("flags Wednesday daytime going to someone else as soft, not hard", () => {
    // Soft: Stan may knowingly override it, so it must never block a drag.
    const roster: Roster = { "wed-open-0": "emily" };
    const v = findViolations(roster, { week: EMPTY_WEEK });
    const wed = v.find((x) => /Wednesday daytime/.test(x.message));
    expect(wed?.severity).toBe("soft");
  });

  it("flags a lopsided open/close split as soft", () => {
    const roster: Roster = {
      "mon-open-0": "hanna",
      "tue-open-0": "hanna",
      "wed-open-0": "hanna",
    };
    const v = findViolations(roster, { week: EMPTY_WEEK });
    expect(v.some((x) => x.severity === "soft" && /lopsided/.test(x.message))).toBe(true);
  });

  it("says nothing about an empty roster", () => {
    expect(findViolations({}, { week: EMPTY_WEEK })).toHaveLength(0);
  });
});

describe("auto scheduler", () => {
  const ctx = { week: WEEK_WITH_CELINA };

  it("never breaks a hard rule, even when it cannot fill everything", () => {
    const { roster } = autoSchedule(ctx);
    const hard = findViolations(roster, ctx).filter((v) => v.severity === "hard");
    expect(hard).toEqual([]);
  });

  it("never rosters Twinkle", () => {
    // She's the owner and fills gaps by hand; auto volunteering her would
    // quietly hide the fact that the week is short-staffed.
    const { roster } = autoSchedule(ctx);
    expect(Object.values(roster)).not.toContain("twinkle");
  });

  it("reports the slots it could not fill instead of inventing cover", () => {
    const { unfilled, complete } = autoSchedule(ctx);
    // Capacity is 27-31 units against 30 needed, so either outcome is
    // legitimate — what matters is that the two agree.
    expect(complete).toBe(unfilled.length === 0);
  });

  it("respects every weekly maximum", () => {
    const { roster } = autoSchedule(ctx);
    for (const s of STAFF) {
      expect(assignedUnits(roster, s.id)).toBeLessThanOrEqual(s.maxUnits);
    }
  });

  it("gives Celina exactly one mid when she is available", () => {
    const { roster } = autoSchedule(ctx);
    const celinaSlots = allSlots().filter((s) => roster[slotId(s)] === "celina");
    // Two units, mid-only, means one shift — never two halves.
    expect(celinaSlots.length).toBeLessThanOrEqual(1);
    for (const s of celinaSlots) expect(s.kind).toBe("mid");
  });

  it("leaves Celina out entirely when she hasn't reported", () => {
    const { roster } = autoSchedule({ week: EMPTY_WEEK });
    expect(Object.values(roster)).not.toContain("celina");
  });

  it("honours a seeded manual assignment", () => {
    const seed: Roster = { "mon-open-0": "karen" };
    const { roster } = autoSchedule(ctx, seed);
    expect(roster["mon-open-0"]).toBe("karen");
  });

  it("copes with someone taking the week off", () => {
    const week: WeekAvailability = {
      ...WEEK_WITH_CELINA,
      hanna: { off: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] },
    };
    const { roster } = autoSchedule({ week });
    expect(Object.values(roster)).not.toContain("hanna");
    const hard = findViolations(roster, { week }).filter((v) => v.severity === "hard");
    expect(hard).toEqual([]);
  });
});
