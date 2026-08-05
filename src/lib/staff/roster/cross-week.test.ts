import { describe, it, expect } from "vitest";
import { WEEKDAYS, staffById, type Roster, type WeekAvailability } from "./model";
import { canWorkSlot, findViolations } from "./rules";
import { autoSchedule } from "./schedule";

// Sunday night into Monday morning is the one turnaround a per-week grid can't
// see, and it was going unchecked: the rule existed and the context field
// existed, but nothing ever populated it, so every Monday opening was compared
// against an empty list. These cover the wiring, not just the rule.

const NO_WEEK: WeekAvailability = {};

function staff(id: string) {
  const s = staffById(id);
  if (!s) throw new Error(id);
  return s;
}

describe("last Sunday's closers can't open Monday", () => {
  it("refuses the placement", () => {
    const r = canWorkSlot(
      staff("hanna"),
      { day: "mon", kind: "open", index: 0 },
      {},
      { week: NO_WEEK, previousWeekSundayCloserIds: ["hanna"] },
    );
    expect(r.ok).toBe(false);
  });

  it("allows it when they didn't close", () => {
    const r = canWorkSlot(
      staff("hanna"),
      { day: "mon", kind: "open", index: 0 },
      {},
      { week: NO_WEEK, previousWeekSundayCloserIds: ["emily"] },
    );
    expect(r.ok).toBe(true);
  });

  it("flags a hand-placed one", () => {
    const roster: Roster = { "mon-open-0": "karen" };
    const v = findViolations(roster, {
      week: NO_WEEK,
      previousWeekSundayCloserIds: ["karen"],
    });
    expect(
      v.some((x) => x.severity === "hard" && /closed the night before/.test(x.message)),
    ).toBe(true);
  });

  it("keeps auto off the Monday opening", () => {
    // The bug in the shipped version: auto happily rostered Sunday's closer
    // straight into Monday's 10am, because nothing supplied the list.
    for (const closer of ["hanna", "emily", "karen"]) {
      const { roster } = autoSchedule({
        week: { celina: { on: ["tue"] } },
        previousWeekSundayCloserIds: [closer],
      });
      expect(roster["mon-open-0"], `${closer} closed Sunday`).not.toBe(closer);
    }
  });

  it("covers both Sunday closing slots, Twinkle's included", () => {
    // Sunday carries a second closer, so "who closed" is never a single name.
    const { roster } = autoSchedule({
      week: { celina: { on: ["tue"] } },
      previousWeekSundayCloserIds: ["hanna", "emily"],
    });
    expect(["hanna", "emily"]).not.toContain(roster["mon-open-0"]);
  });

  it("still rosters the week when the constraint bites", () => {
    // Losing one opener for Monday must not collapse the week — the same
    // failure mode a day of leave used to cause.
    const { roster, unfilled } = autoSchedule({
      week: { celina: { on: ["tue"] } },
      previousWeekSundayCloserIds: ["hanna"],
    });
    expect(Object.keys(roster).length).toBeGreaterThanOrEqual(20);
    expect(unfilled.length).toBeLessThanOrEqual(1);
  });

  it("treats an empty list as no constraint", () => {
    // First week ever rostered, or a week whose predecessor was never saved.
    const { unfilled } = autoSchedule({
      week: { celina: { on: ["tue"] } },
      previousWeekSundayCloserIds: [],
    });
    expect(unfilled).toHaveLength(0);
    expect(WEEKDAYS).toHaveLength(7);
  });
});
