import {
  COMFORTABLE_DAYS,
  STAFF,
  SHIFT_UNITS,
  WEEKDAYS,
  allSlots,
  autoSlots,
  assignedUnits,
  countKind,
  dayIndex,
  daysWorked,
  SHIFT_LABEL,
  isAvailableForShift,
  isLateShift,
  makesRunOfThree,
  previousDay,
  runsOfThree,
  slotId,
  staffById,
  type Roster,
  type Slot,
  type Staff,
  type WeekAvailability,
  type Weekday,
} from "./model";

// Rule checking, shared by the auto-scheduler and by manual drag-and-drop.
//
// Two severities, and the split matters:
//
//   * `hard` — would break the shop. Someone closing at 22:30 cannot open at
//     10:00 the next morning; someone can't work a shift they're not available
//     for. Auto never produces these. Manual mode still *shows* rather than
//     blocks them, because Stan sometimes knows something the rules don't
//     (a staff member agreed to it, Twinkle is covering).
//
//   * `soft` — preferences worth surfacing but not worth refusing. Wednesday
//     daytime going to Hanna and Karen, opens and closes being spread evenly.

export type Severity = "hard" | "soft";

export type Violation = {
  severity: Severity;
  /** Slots the violation points at, for highlighting in the grid. */
  slotIds: string[];
  staffId?: string;
  message: string;
};

/**
 * Closers cannot open the next morning. `previousWeekSundayCloserIds` carries
 * the rule across the week boundary — without it, every Monday opening would
 * be checked against nothing and the one turnaround most likely to be missed
 * (Sunday night into Monday morning) would be the one we never catch.
 */
export type RuleContext = {
  week: WeekAvailability;
  previousWeekSundayCloserIds?: string[];
  /**
   * The staff list as it stood for this week. Days, shift kinds and weekly
   * allowances are editable now, so a week has to be judged against the shape
   * that actually applied to it — a roster from before someone's availability
   * changed shouldn't light up with violations afterwards. Defaults to the
   * code list.
   */
  staff?: Staff[];
};

export function staffOf(ctx: RuleContext): Staff[] {
  return ctx.staff ?? STAFF;
}

export function canWorkSlot(
  staff: Staff,
  slot: Slot,
  roster: Roster,
  ctx: RuleContext,
): { ok: true } | { ok: false; reason: string } {
  if (!staff.kinds.includes(slot.kind)) {
    return { ok: false, reason: `${staff.name} doesn't work ${slot.kind} shifts` };
  }
  if (!isAvailableForShift(staff, slot.day, slot.kind, ctx.week)) {
    return {
      ok: false,
      reason: `${staff.name} isn't available for ${SHIFT_LABEL[slot.kind]} on ${slot.day}`,
    };
  }

  // One person, one shift per day. Without this the scheduler will happily
  // put someone on both open and close of the same day, which reads as a
  // legal 2-unit assignment but is a 12.5-hour span.
  for (const other of allSlots()) {
    if (other.day !== slot.day) continue;
    if (slotId(other) === slotId(slot)) continue;
    if (roster[slotId(other)] === staff.id) {
      return { ok: false, reason: `${staff.name} is already on ${slot.day}` };
    }
  }

  if (assignedUnits(roster, staff.id) + SHIFT_UNITS[slot.kind] > staff.maxUnits) {
    return { ok: false, reason: `${staff.name} would exceed ${staff.maxUnits} units` };
  }

  // The close-then-open rule is symmetric, so it has to be checked from both
  // ends. Checking it only when placing the opening shift would let the same
  // pair through whenever the opening was placed first and the closing after.
  if (slot.kind === "open" && closedPreviousNight(staff.id, slot.day, roster, ctx)) {
    return { ok: false, reason: `${staff.name} closed the night before` };
  }
  if (slot.kind === "close" && opensNextMorning(staff.id, slot.day, roster)) {
    return { ok: false, reason: `${staff.name} opens the next morning` };
  }

  if (slot.kind === "mid" && worksMidAdjacentDay(staff.id, slot.day, roster)) {
    return { ok: false, reason: `${staff.name} works 12-22 on an adjacent day` };
  }

  // No three days in a row of the same footing — three 10am starts, or three
  // nights finishing after 22:00.
  if (slot.kind === "open" && makesRunOfThree(daysWorking(staff.id, roster, "open"), slot.day)) {
    return { ok: false, reason: `${staff.name} would open three days running` };
  }
  if (
    isLateShift(slot.kind) &&
    makesRunOfThree(daysWorking(staff.id, roster, "late"), slot.day)
  ) {
    return { ok: false, reason: `${staff.name} would work three late nights running` };
  }

  return { ok: true };
}

/** Days this person works `open`, or any late-finishing shift. */
function daysWorking(
  staffId: string,
  roster: Roster,
  which: "open" | "late",
): Set<Weekday> {
  const days = new Set<Weekday>();
  for (const s of allSlots()) {
    if (roster[slotId(s)] !== staffId) continue;
    const match = which === "open" ? s.kind === "open" : isLateShift(s.kind);
    if (match) days.add(s.day);
  }
  return days;
}

function opensNextMorning(staffId: string, day: Weekday, roster: Roster): boolean {
  const i = dayIndex(day);
  const next = i >= 0 && i < WEEKDAYS.length - 1 ? WEEKDAYS[i + 1] : null;
  if (!next) return false;
  return allSlots().some(
    (s) => s.day === next && s.kind === "open" && roster[slotId(s)] === staffId,
  );
}

function closedPreviousNight(
  staffId: string,
  day: Weekday,
  roster: Roster,
  ctx: RuleContext,
): boolean {
  const prev = previousDay(day);
  if (!prev) {
    // Monday: the only closers that matter are last week's Sunday ones.
    return (ctx.previousWeekSundayCloserIds ?? []).includes(staffId);
  }
  return allSlots().some(
    (s) => s.day === prev && s.kind === "close" && roster[slotId(s)] === staffId,
  );
}

function worksMidAdjacentDay(staffId: string, day: Weekday, roster: Roster): boolean {
  return allSlots().some(
    (s) =>
      s.kind === "mid" &&
      dayDistance(s.day, day) === 1 &&
      roster[slotId(s)] === staffId,
  );
}

function dayDistance(a: Weekday, b: Weekday): number {
  return Math.abs(dayIndex(a) - dayIndex(b));
}

/** Full-roster check. Used to annotate a manually edited grid. */
export function findViolations(roster: Roster, ctx: RuleContext): Violation[] {
  const out: Violation[] = [];
  const slots = allSlots();

  for (const slot of slots) {
    const id = roster[slotId(slot)];
    if (!id) continue;
    const staff = staffById(id, staffOf(ctx));
    if (!staff) continue;

    if (!staff.kinds.includes(slot.kind)) {
      out.push({
        severity: "hard",
        slotIds: [slotId(slot)],
        staffId: id,
        message: `${staff.name} doesn't work the ${slot.kind} shift`,
      });
    }
    if (!isAvailableForShift(staff, slot.day, slot.kind, ctx.week)) {
      out.push({
        severity: "hard",
        slotIds: [slotId(slot)],
        staffId: id,
        message: `${staff.name} is off for ${SHIFT_LABEL[slot.kind]} on ${slot.day} this week`,
      });
    }
    if (slot.kind === "open") {
      const prev = previousDay(slot.day);
      const closers = prev
        ? slots
            .filter((s) => s.day === prev && s.kind === "close")
            .map((s) => roster[slotId(s)])
        : (ctx.previousWeekSundayCloserIds ?? []);
      if (closers.includes(id)) {
        out.push({
          severity: "hard",
          slotIds: [slotId(slot)],
          staffId: id,
          message: `${staff.name} closed the night before and can't open`,
        });
      }
    }
  }

  // Same person twice in one day.
  for (const day of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as Weekday[]) {
    const seen = new Map<string, string[]>();
    for (const slot of slots.filter((s) => s.day === day)) {
      const id = roster[slotId(slot)];
      if (!id) continue;
      seen.set(id, [...(seen.get(id) ?? []), slotId(slot)]);
    }
    for (const [id, ids] of seen) {
      if (ids.length > 1) {
        out.push({
          severity: "hard",
          slotIds: ids,
          staffId: id,
          message: `${staffById(id, staffOf(ctx))?.name ?? id} is on two shifts on ${day}`,
        });
      }
    }
  }

  // Three days in a row opening, or three late nights in a row.
  for (const staff of new Set(
    Object.values(roster).filter(Boolean).map((id) => staffById(id!, staffOf(ctx))),
  )) {
    if (!staff) continue;
    for (const run of runsOfThree(daysWorking(staff.id, roster, "open"))) {
      out.push({
        severity: "hard",
        slotIds: run.map((d) => `${d}-open-0`),
        staffId: staff.id,
        message: `${staff.name} opens three days running (${run.join(", ")})`,
      });
    }
    for (const run of runsOfThree(daysWorking(staff.id, roster, "late"))) {
      out.push({
        severity: "hard",
        slotIds: [],
        staffId: staff.id,
        message: `${staff.name} works three late nights running (${run.join(", ")})`,
      });
    }
  }

  // Consecutive mids.
  const midDays = new Map<string, Weekday[]>();
  for (const slot of slots.filter((s) => s.kind === "mid")) {
    const id = roster[slotId(slot)];
    if (!id) continue;
    midDays.set(id, [...(midDays.get(id) ?? []), slot.day]);
  }
  for (const [id, days] of midDays) {
    for (const a of days) {
      for (const b of days) {
        if (a !== b && dayDistance(a, b) === 1) {
          out.push({
            severity: "hard",
            slotIds: [`${a}-mid-0`, `${b}-mid-0`],
            staffId: id,
            message: `${staffById(id, staffOf(ctx))?.name ?? id} works 12-22 on consecutive days (${a}, ${b})`,
          });
        }
      }
    }
  }

  // Weekly allowances.
  for (const staff of new Set(
    Object.values(roster).filter(Boolean).map((id) => staffById(id!, staffOf(ctx))),
  )) {
    if (!staff) continue;
    const units = assignedUnits(roster, staff.id);
    if (units > staff.maxUnits) {
      out.push({
        severity: "hard",
        slotIds: [],
        staffId: staff.id,
        message: `${staff.name} has ${units} units, over their max of ${staff.maxUnits}`,
      });
    } else if (units < staff.minUnits) {
      out.push({
        severity: "soft",
        slotIds: [],
        staffId: staff.id,
        message: `${staff.name} has ${units} units, under their usual ${staff.minUnits}`,
      });
    }

    // Days on. Soft, because a short week sometimes leaves no alternative —
    // Stan's rule is "avoid it if you can, otherwise fine".
    const days = daysWorked(roster, staff.id);
    if (days > COMFORTABLE_DAYS) {
      out.push({
        severity: "soft",
        slotIds: [],
        staffId: staff.id,
        message: `${staff.name} works ${days} days this week`,
      });
    }

    // Opens vs closes. Someone with a week of nothing but openings is
    // technically legal and practically unfair, which is why this is checked
    // per person rather than only as a global total.
    const opens = countKind(roster, staff.id, "open");
    const closes = countKind(roster, staff.id, "close");
    if (Math.abs(opens - closes) > 2) {
      out.push({
        severity: "soft",
        slotIds: [],
        staffId: staff.id,
        message: `${staff.name} has ${opens} opens vs ${closes} closes — lopsided`,
      });
    }
  }

  // Wednesday daytime preference.
  const wedDay = slots.find((s) => s.day === "wed" && s.kind === "open");
  const wedMid = slots.find((s) => s.day === "wed" && s.kind === "mid");
  for (const slot of [wedDay, wedMid]) {
    if (!slot) continue;
    const id = roster[slotId(slot)];
    if (id && id !== "hanna" && id !== "karen") {
      out.push({
        severity: "soft",
        slotIds: [slotId(slot)],
        staffId: id,
        message: `Wednesday daytime usually goes to Hanna or Karen`,
      });
    }
  }

  return out;
}

/**
 * Slots the roster is short of. Twinkle's evening slots are excluded — they
 * are meant to sit empty until she takes them, so counting them would report
 * every finished roster as incomplete.
 */
export function unfilledSlots(roster: Roster): Slot[] {
  return autoSlots().filter((s) => !roster[slotId(s)]);
}
