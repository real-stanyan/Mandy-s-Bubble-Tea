import { describe, it, expect } from "vitest";
import {
  STAFF,
  comfortableDayCapacity,
  profileOf,
  resolveStaff,
  staffById,
  type ProfileOverrides,
  type WeekAvailability,
} from "./model";
import { autoSchedule } from "./schedule";

// Staff shape is editable now, which only works if the edit reaches the
// scheduler. It is easy to build a settings screen that saves happily and
// changes nothing, so these check the effect rather than the storage.

const CELINA_IN: WeekAvailability = { celina: { on: ["tue"] } };

function elleIn(staff: ReturnType<typeof resolveStaff>) {
  const e = staff.find((s) => s.id === "elle");
  if (!e) throw new Error("no elle");
  return e;
}

describe("resolveStaff", () => {
  it("returns the code defaults when nothing is overridden", () => {
    expect(resolveStaff({})).toEqual(STAFF);
  });

  it("replaces only the editable parts, keeping name, colour and auto", () => {
    const overrides: ProfileOverrides = {
      elle: {
        days: ["fri", "sat", "sun"],
        kinds: ["open", "mid", "close"],
        minUnits: 3,
        maxUnits: 6,
      },
    };
    const elle = elleIn(resolveStaff(overrides));
    expect(elle.days).toEqual(["fri", "sat", "sun"]);
    expect(elle.maxUnits).toBe(6);
    // Identity stays in code — an override can't rename or recolour someone.
    expect(elle.name).toBe("Elle");
    expect(elle.color).toBe(elleIn(resolveStaff({})).color);
    expect(elle.auto).toBe(true);
  });

  it("leaves everyone else untouched", () => {
    const staff = resolveStaff({ elle: { days: ["mon"], kinds: ["mid"], minUnits: 1, maxUnits: 2 } });
    expect(staffById("hanna", staff)).toEqual(staffById("hanna", STAFF));
  });
});

describe("an override actually changes the roster", () => {
  it("lets Elle work more days once her profile allows it", () => {
    const before = autoSchedule({ week: CELINA_IN });
    const beforeElle = Object.values(before.roster).filter((id) => id === "elle").length;

    const staff = resolveStaff({
      elle: {
        days: ["wed", "thu", "fri", "sat", "sun"],
        kinds: ["open", "mid", "close"],
        minUnits: 4,
        maxUnits: 6,
      },
    });
    const after = autoSchedule({ week: CELINA_IN, staff });
    const afterElle = Object.values(after.roster).filter((id) => id === "elle").length;

    // Saturday-only, two units, was one shift. With the wider profile she has
    // to be doing more, or the override never reached the scheduler.
    expect(beforeElle).toBeLessThanOrEqual(1);
    expect(afterElle).toBeGreaterThan(beforeElle);
  });

  it("counts the override in comfortable-day capacity", () => {
    const base = comfortableDayCapacity(CELINA_IN);
    const staff = resolveStaff({
      elle: {
        days: ["wed", "thu", "fri", "sat", "sun"],
        kinds: ["open", "mid", "close"],
        minUnits: 4,
        maxUnits: 6,
      },
    });
    // Elle goes from one comfortable day to five, so the shortfall the board
    // explains has to move with her.
    expect(comfortableDayCapacity(CELINA_IN, staff)).toBeGreaterThan(base);
  });

  it("keeps Elle's openings down to about one", () => {
    // She can open now, but the shop wants it used sparingly. Soft, so the
    // check is "not many", not "never".
    const staff = resolveStaff({
      elle: {
        days: ["wed", "thu", "fri", "sat", "sun"],
        kinds: ["open", "mid", "close"],
        minUnits: 4,
        maxUnits: 6,
      },
    });
    const { roster } = autoSchedule({ week: CELINA_IN, staff });
    const opens = Object.entries(roster).filter(
      ([slot, id]) => id === "elle" && slot.includes("-open-"),
    ).length;
    expect(opens).toBeLessThanOrEqual(1);
  });
});

describe("profileOf", () => {
  it("round-trips through resolveStaff", () => {
    const elle = elleIn(STAFF);
    const staff = resolveStaff({ elle: profileOf(elle) });
    expect(elleIn(staff)).toEqual(elle);
  });
});
