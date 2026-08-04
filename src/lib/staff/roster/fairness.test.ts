import { describe, it, expect } from "vitest";
import {
  STAFF,
  WEEKDAYS,
  assignedUnits,
  countKind,
  type WeekAvailability,
} from "./model";
import { findViolations } from "./rules";
import { autoSchedule } from "./schedule";

// Fairness is the rule most likely to regress silently: a roster that breaks
// it still looks like a valid week. These pin it down for the two cases that
// matter — a fully staffed week, and a short one.

function imbalance(roster: Record<string, string | undefined>) {
  return STAFF.filter((s) => assignedUnits(roster, s.id) > 0).map((s) => ({
    name: s.name,
    diff: Math.abs(countKind(roster, s.id, "open") - countKind(roster, s.id, "close")),
  }));
}

describe("open/close fairness", () => {
  it("spreads opens and closes when the week is fully staffed", () => {
    const ctx = { week: { celina: { on: ["tue" as const] } } };
    const { roster } = autoSchedule(ctx);
    for (const { name, diff } of imbalance(roster)) {
      // Nobody should be more than two shifts lopsided. The original search
      // regularly produced 1-open/4-close weeks before the swap pass.
      expect(diff, `${name} is ${diff} shifts lopsided`).toBeLessThanOrEqual(2);
    }
  });

  it("still spreads them when the week cannot be filled", () => {
    // Two people away leaves the week genuinely short, so every placement is
    // forced. This is the case that used to skip the improvement pass
    // entirely and hand one person all seven openings.
    const ctx = {
      week: {
        emily: { off: [...WEEKDAYS] },
        eugenia: { off: [...WEEKDAYS] },
      } as WeekAvailability,
    };
    const { roster, complete } = autoSchedule(ctx);
    expect(complete).toBe(false);
    for (const { name, diff } of imbalance(roster)) {
      expect(diff, `${name} is ${diff} shifts lopsided`).toBeLessThanOrEqual(2);
    }
  });

  it("never rosters three openings or three late nights in a row", () => {
    // The rule most likely to reappear: before it existed the search gave one
    // person Monday-to-Thursday openings, which reads as a perfectly ordinary
    // roster until you're the one starting at 10am four days straight.
    const weeks: WeekAvailability[] = [{}, { celina: { on: ["tue"] } }];
    for (const week of weeks) {
      const { roster } = autoSchedule({ week });
      const bad = findViolations(roster, { week }).filter(
        (v) => /three days running|three late nights/.test(v.message),
      );
      expect(bad).toEqual([]);
    }
  });

  it("never trades a hard rule for fairness", () => {
    const weeks: WeekAvailability[] = [{}, { celina: { on: ["wed"] } }];
    for (const week of weeks) {
      const ctx = { week };
      const { roster } = autoSchedule(ctx);
      const hard = findViolations(roster, ctx).filter((v) => v.severity === "hard");
      expect(hard).toEqual([]);
    }
  });
});
