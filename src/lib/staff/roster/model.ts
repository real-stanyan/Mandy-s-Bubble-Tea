// Shape of a week's roster: the days, the shifts, who can work them, and how
// much a shift "costs" against someone's weekly allowance.
//
// The one number that drives most of this file: a `mid` shift counts as TWO
// shift-units. It is a 10-hour shift against the others' 5-7, so every weekly
// allowance, fairness check and capacity total is expressed in units, never in
// "number of times rostered".

export const WEEKDAYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export type ShiftKind = "open" | "mid" | "close";

export const SHIFT_LABEL: Record<ShiftKind, string> = {
  open: "10-17",
  mid: "12-22",
  close: "17-22:30",
};

/** Weekly-allowance cost of each shift. `mid` is a double. */
export const SHIFT_UNITS: Record<ShiftKind, number> = {
  open: 1,
  mid: 2,
  close: 1,
};

/** The busy nights, which carry a second closer — Twinkle's slot. */
export const EXTRA_CLOSER_DAYS: Weekday[] = ["fri", "sat", "sun"];

/**
 * Fri, Sat and Sun carry a second closer. Everything else is one person per
 * shift. Expressed as a count per (day, kind) so the grid and the scheduler
 * agree on how many slots exist without either of them hardcoding "4 on
 * Friday".
 */
export function slotCount(day: Weekday, kind: ShiftKind): number {
  if (kind === "close" && EXTRA_CLOSER_DAYS.includes(day)) return 2;
  return 1;
}

export type Slot = {
  day: Weekday;
  kind: ShiftKind;
  /** 0-based position within (day, kind) — only ever 1 for the Fri/Sat closer. */
  index: number;
};

export function slotId(slot: Slot): string {
  return `${slot.day}-${slot.kind}-${slot.index}`;
}

/**
 * The extra evening body on the busy nights is Twinkle's slot. The
 * auto-scheduler leaves it alone: she is the owner, she decides when she's in,
 * and volunteering her would both misstate the roster and use up capacity the
 * staff rota is measured against.
 *
 * It still appears on the grid and can still be filled by hand — including
 * with someone other than Twinkle when she isn't available.
 */
export function isOwnerSlot(slot: Slot): boolean {
  return slot.kind === "close" && slot.index === 1;
}

export function allSlots(): Slot[] {
  const out: Slot[] = [];
  for (const day of WEEKDAYS) {
    for (const kind of ["open", "mid", "close"] as ShiftKind[]) {
      for (let index = 0; index < slotCount(day, kind); index++) {
        out.push({ day, kind, index });
      }
    }
  }
  return out;
}

/** 30 for the current shape — 20 across Mon-Thu+Sun, 10 across Fri+Sat. */
export function totalUnits(): number {
  return allSlots().reduce((sum, s) => sum + SHIFT_UNITS[s.kind], 0);
}

export type AvailabilityMode =
  /** Available on their usual days unless marked off for the week. */
  | "opt-out"
  /** Unavailable unless days are entered for the week. */
  | "opt-in";

export type Staff = {
  id: string;
  name: string;
  /** Tailwind-ish hex, mirrored from the spreadsheet everyone already knows. */
  color: string;
  /** Baseline days. Narrowed further by the week's availability. */
  days: Weekday[];
  /** Shift kinds this person can work at all. */
  kinds: ShiftKind[];
  minUnits: number;
  maxUnits: number;
  availability: AvailabilityMode;
  /**
   * Whether the auto-scheduler may roster this person. Twinkle is the owner
   * and fills gaps by hand, so auto leaves her slots empty rather than
   * volunteering her.
   */
  auto: boolean;
};

export const STAFF: Staff[] = [
  {
    id: "hanna",
    name: "Hanna",
    color: "#F5A03C",
    days: [...WEEKDAYS],
    kinds: ["open", "mid", "close"],
    minUnits: 7,
    maxUnits: 7,
    availability: "opt-out",
    auto: true,
  },
  {
    id: "emily",
    name: "Emily",
    color: "#4C7FE0",
    days: [...WEEKDAYS],
    kinds: ["open", "mid", "close"],
    minUnits: 6,
    maxUnits: 7,
    availability: "opt-out",
    auto: true,
  },
  {
    id: "karen",
    name: "Karen",
    color: "#5BE1F0",
    days: [...WEEKDAYS],
    kinds: ["open", "mid", "close"],
    minUnits: 6,
    maxUnits: 7,
    availability: "opt-out",
    auto: true,
  },
  {
    id: "eugenia",
    name: "Eugenia",
    color: "#F5E93C",
    days: ["wed", "thu", "fri", "sat"],
    kinds: ["open", "mid", "close"],
    minUnits: 5,
    maxUnits: 6,
    availability: "opt-out",
    auto: true,
  },
  {
    id: "celina",
    name: "Celina",
    color: "#5BE066",
    days: [...WEEKDAYS],
    // Mid only, and two units is exactly one mid — so Celina is always
    // "one 12-22 somewhere this week", never two half-shifts.
    kinds: ["mid"],
    minUnits: 2,
    maxUnits: 2,
    // She reports a week ahead. A blank week means "hasn't told us", and
    // treating that as available would roster someone who never agreed.
    availability: "opt-in",
    auto: true,
  },
  {
    id: "elle",
    name: "Elle",
    color: "#A855F7",
    days: ["sat"],
    // Cannot open; mid and close are both fine.
    kinds: ["mid", "close"],
    minUnits: 1,
    maxUnits: 2,
    availability: "opt-out",
    auto: true,
  },
  {
    id: "twinkle",
    name: "Twinkle",
    color: "#94A3B8",
    days: [...WEEKDAYS],
    kinds: ["open", "mid", "close"],
    minUnits: 0,
    maxUnits: 99,
    availability: "opt-out",
    auto: false,
  },
];

export function staffById(id: string): Staff | undefined {
  return STAFF.find((s) => s.id === id);
}

/** Identifies one shift on one day, e.g. `tue-open`. */
export type ShiftKey = `${Weekday}-${ShiftKind}`;

export function shiftKey(day: Weekday, kind: ShiftKind): ShiftKey {
  return `${day}-${kind}`;
}

/**
 * What a given week changes about the baseline.
 *
 * `off` / `on` work at day granularity, which covers most of it — someone is
 * away Tuesday and Wednesday. `offShifts` / `onShifts` go finer, because leave
 * often isn't a whole day: someone has an appointment Thursday morning and can
 * still do the evening. Without that, marking the day off would give away two
 * shifts to cover one.
 */
export type WeekAvailability = Record<
  string,
  {
    off?: Weekday[];
    on?: Weekday[];
    offShifts?: ShiftKey[];
    onShifts?: ShiftKey[];
  }
>;

/** Can this person work this specific shift, this week? */
export function isAvailableForShift(
  staff: Staff,
  day: Weekday,
  kind: ShiftKind,
  week: WeekAvailability,
): boolean {
  if (!staff.kinds.includes(kind)) return false;
  const entry = week[staff.id];
  const key = shiftKey(day, kind);

  if (staff.availability === "opt-in") {
    if (!staff.days.includes(day)) return false;
    // A named shift is the more specific statement, so it wins over the day.
    if ((entry?.onShifts ?? []).includes(key)) return true;
    return (entry?.on ?? []).includes(day) && !(entry?.offShifts ?? []).includes(key);
  }

  if (!staff.days.includes(day)) return false;
  if ((entry?.off ?? []).includes(day)) return false;
  return !(entry?.offShifts ?? []).includes(key);
}

/**
 * Available for *something* that day. Used where the question is about days
 * rather than shifts — the comfortable-days capacity, and the day toggles in
 * the availability panel.
 */
export function isAvailable(
  staff: Staff,
  day: Weekday,
  week: WeekAvailability,
): boolean {
  return staff.kinds.some((kind) => isAvailableForShift(staff, day, kind, week));
}

/** slotId -> staff id. Absent key means the slot is unfilled. */
export type Roster = Record<string, string | undefined>;

export function assignedUnits(roster: Roster, staffId: string): number {
  let units = 0;
  for (const slot of allSlots()) {
    if (roster[slotId(slot)] === staffId) units += SHIFT_UNITS[slot.kind];
  }
  return units;
}

/**
 * Calendar days this person works, which is not the same as their shift-unit
 * total: a `12-22` is two units but still only one day. Six days on is the
 * thing staff actually feel, so it is counted separately from the allowance.
 */
export function daysWorked(roster: Roster, staffId: string): number {
  const days = new Set<Weekday>();
  for (const slot of allSlots()) {
    if (roster[slotId(slot)] === staffId) days.add(slot.day);
  }
  return days.size;
}

/** Above this, someone is working what the shop considers too many days. */
export const COMFORTABLE_DAYS = 5;

/**
 * The most days this person could work while staying inside the comfortable
 * limit. Bounded by three separate things, and all three bite for somebody on
 * the current list: the comfort cap (Hanna), how many days they are available
 * at all (Eugenia, Wed-Sat), and how few days their unit allowance can spread
 * across (Celina — mid-only at two units is exactly one shift, so one day, not
 * two).
 */
export function maxComfortableDays(
  staff: Staff,
  week: WeekAvailability = {},
): number {
  const cheapestShift = Math.min(...staff.kinds.map((k) => SHIFT_UNITS[k]));
  // Days available *this week*, not the baseline: someone on holiday, or
  // Celina before she has reported, contributes nothing and the shortfall has
  // to say so rather than quoting a capacity nobody can supply.
  const available = WEEKDAYS.filter((d) => isAvailable(staff, d, week)).length;
  return Math.min(
    COMFORTABLE_DAYS,
    available,
    Math.floor(staff.maxUnits / cheapestShift),
  );
}

/**
 * How many shifts would have to go unfilled — or be picked up by Twinkle — for
 * nobody to exceed the comfortable day limit.
 *
 * Every slot is one person-day, so this is simply demand minus the sum of what
 * everyone can comfortably give. It is positive on the current staff list:
 * 23 slots against 21 comfortable person-days. That is a fact about the roster
 * shape, not a scheduling failure, and it is why the board explains a six-day
 * week rather than just flagging it.
 */
export function comfortableDayCapacity(week: WeekAvailability = {}): number {
  return STAFF.filter((s) => s.auto).reduce(
    (n, s) => n + maxComfortableDays(s, week),
    0,
  );
}

/** Slots the auto-scheduler is responsible for — everything but Twinkle's. */
export function autoSlots(): Slot[] {
  return allSlots().filter((s) => !isOwnerSlot(s));
}

/**
 * Shifts that would have to go unfilled for nobody to exceed the comfortable
 * day limit. Measured against the slots auto actually fills: Twinkle's evening
 * slots are hers, so counting them here would report a staffing gap that isn't
 * one.
 */
export function comfortableDayShortfall(week: WeekAvailability = {}): number {
  return autoSlots().length - comfortableDayCapacity(week);
}

export function countKind(roster: Roster, staffId: string, kind: ShiftKind): number {
  let n = 0;
  for (const slot of allSlots()) {
    if (slot.kind === kind && roster[slotId(slot)] === staffId) n++;
  }
  return n;
}

export function dayIndex(day: Weekday): number {
  return WEEKDAYS.indexOf(day);
}

export function previousDay(day: Weekday): Weekday | null {
  const i = dayIndex(day);
  return i <= 0 ? null : WEEKDAYS[i - 1];
}

/**
 * A `mid` finishes at 22:00 and a `close` at 22:30, so both are late nights as
 * far as the person working them is concerned. The "no three late nights in a
 * row" rule counts them together — three of these back to back is the same
 * week whether or not they were the same shift.
 */
export function isLateShift(kind: ShiftKind): boolean {
  return kind === "close" || kind === "mid";
}

/**
 * Would adding `day` to `days` create three consecutive days? Checks the three
 * windows `day` can sit in: as the end, the middle, or the start of the run.
 */
export function makesRunOfThree(days: Set<Weekday>, day: Weekday): boolean {
  const i = dayIndex(day);
  const has = (k: number) => k >= 0 && k < WEEKDAYS.length && days.has(WEEKDAYS[k]);
  return (
    (has(i - 2) && has(i - 1)) ||
    (has(i - 1) && has(i + 1)) ||
    (has(i + 1) && has(i + 2))
  );
}

/** Every run of three-or-more consecutive days in `days`, as day triples. */
export function runsOfThree(days: Set<Weekday>): Weekday[][] {
  const out: Weekday[][] = [];
  for (let i = 0; i + 2 < WEEKDAYS.length; i++) {
    const window = [WEEKDAYS[i], WEEKDAYS[i + 1], WEEKDAYS[i + 2]];
    if (window.every((d) => days.has(d))) out.push(window);
  }
  return out;
}
