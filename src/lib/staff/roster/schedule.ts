import {
  SHIFT_UNITS,
  COMFORTABLE_DAYS,
  STAFF,
  WEEKDAYS,
  autoSlots,
  assignedUnits,
  countKind,
  dayIndex,
  daysWorked,
  isAvailableForShift,
  isLateShift,
  makesRunOfThree,
  slotId,
  type Roster,
  type Slot,
  type Staff,
  maxComfortableDays,
  type WeekAvailability,
  type Weekday,
} from "./model";
import { findViolations, unfilledSlots, type RuleContext } from "./rules";

// Auto-scheduler.
//
// Capacity is almost exactly demand — roughly 30 units needed against 27-31
// available, with Twinkle deliberately excluded — so a greedy pass that paints
// itself into a corner is the expected case, not a rare one. Hence
// backtracking: fill the most-constrained slot first, try candidates in
// fairness order, undo when a branch dead-ends.
//
// An unfillable week is a legitimate result. The scheduler returns the fullest
// roster it reached along with the slots it could not fill, rather than
// throwing or emitting something that breaks a hard rule.
//
// Rule checks run against an incremental `State` rather than by re-scanning
// the roster. The rules themselves are the same ones `rules.ts` applies to a
// hand-edited grid; they are restated here in O(1) form because the search
// evaluates them tens of thousands of times and the roster-scanning version
// made the search quadratic in the number of slots.

// Everything the scheduler is responsible for. Twinkle's extra evening slots
// are excluded: they stay empty for her to take by hand, and treating them as
// demand would both draft staff into her shift and report the week as short
// when it isn't.
const SLOTS = autoSlots();

export type ScheduleResult = {
  roster: Roster;
  unfilled: Slot[];
  complete: boolean;
};

type State = {
  roster: Roster;
  units: Map<string, number>;
  /** Days each person is already working — one shift per person per day. */
  busy: Map<string, Set<Weekday>>;
  mids: Map<string, Set<Weekday>>;
  opens: Map<string, Set<Weekday>>;
  closes: Map<string, Set<Weekday>>;
  /** Days ending at 22:00 or later — `mid` and `close` together. */
  lates: Map<string, Set<Weekday>>;
};

function emptyState(): State {
  return {
    roster: {},
    units: new Map(),
    busy: new Map(),
    mids: new Map(),
    opens: new Map(),
    closes: new Map(),
    lates: new Map(),
  };
}

function daysOf(map: Map<string, Set<Weekday>>, id: string): Set<Weekday> {
  let set = map.get(id);
  if (!set) {
    set = new Set();
    map.set(id, set);
  }
  return set;
}

function place(state: State, slot: Slot, staffId: string) {
  state.roster[slotId(slot)] = staffId;
  state.units.set(staffId, (state.units.get(staffId) ?? 0) + SHIFT_UNITS[slot.kind]);
  daysOf(state.busy, staffId).add(slot.day);
  if (slot.kind === "mid") daysOf(state.mids, staffId).add(slot.day);
  if (slot.kind === "open") daysOf(state.opens, staffId).add(slot.day);
  if (slot.kind === "close") daysOf(state.closes, staffId).add(slot.day);
  if (isLateShift(slot.kind)) daysOf(state.lates, staffId).add(slot.day);
}

function unplace(state: State, slot: Slot, staffId: string) {
  delete state.roster[slotId(slot)];
  state.units.set(staffId, (state.units.get(staffId) ?? 0) - SHIFT_UNITS[slot.kind]);
  daysOf(state.busy, staffId).delete(slot.day);
  if (slot.kind === "mid") daysOf(state.mids, staffId).delete(slot.day);
  if (slot.kind === "open") daysOf(state.opens, staffId).delete(slot.day);
  if (slot.kind === "close") daysOf(state.closes, staffId).delete(slot.day);
  if (isLateShift(slot.kind)) daysOf(state.lates, staffId).delete(slot.day);
}

function neighbourDays(day: Weekday): Weekday[] {
  const i = dayIndex(day);
  const out: Weekday[] = [];
  if (i > 0) out.push(WEEKDAYS[i - 1]);
  if (i < WEEKDAYS.length - 1) out.push(WEEKDAYS[i + 1]);
  return out;
}

function fits(staff: Staff, slot: Slot, state: State, ctx: RuleContext): boolean {
  if (!staff.kinds.includes(slot.kind)) return false;
  if (!isAvailableForShift(staff, slot.day, slot.kind, ctx.week)) return false;
  if (daysOf(state.busy, staff.id).has(slot.day)) return false;
  if ((state.units.get(staff.id) ?? 0) + SHIFT_UNITS[slot.kind] > staff.maxUnits) {
    return false;
  }

  const i = dayIndex(slot.day);
  const prev = i > 0 ? WEEKDAYS[i - 1] : null;
  const next = i < WEEKDAYS.length - 1 ? WEEKDAYS[i + 1] : null;

  // Close-then-open, checked from both ends: placing the opening first and
  // the closing afterwards has to be refused just the same.
  if (slot.kind === "open") {
    if (prev && daysOf(state.closes, staff.id).has(prev)) return false;
    if (!prev && (ctx.previousWeekSundayCloserIds ?? []).includes(staff.id)) return false;
  }
  if (slot.kind === "close" && next && daysOf(state.opens, staff.id).has(next)) {
    return false;
  }

  if (slot.kind === "mid") {
    for (const d of neighbourDays(slot.day)) {
      if (daysOf(state.mids, staff.id).has(d)) return false;
    }
  }

  // No three days in a row on the same footing: three straight openings is
  // three straight 10am starts, and three straight late finishes is three
  // nights home after 22:00. Both were reachable before this rule — the
  // search happily gave one person Monday-to-Thursday openings.
  if (slot.kind === "open" && makesRunOfThree(daysOf(state.opens, staff.id), slot.day)) {
    return false;
  }
  if (isLateShift(slot.kind) && makesRunOfThree(daysOf(state.lates, staff.id), slot.day)) {
    return false;
  }

  return true;
}

// Budget for the search. With O(1) rule checks this is milliseconds; it exists
// so an impossible week fails fast with a best-effort partial instead of
// hanging the request.
const MAX_STEPS = 60_000;

/**
 * How many differently-biased attempts to make before keeping the best.
 *
 * Measured on the real staff list: 4, 8 and 12 attempts all land on the same
 * soft cost, because `improve()` below is what actually fixes fairness — the
 * restarts barely move it, since the most-constrained-first slot ordering is
 * deterministic and most placements are forced. Kept at 4 (~300ms) rather than
 * removed entirely: it costs little and gives the search a second chance when
 * a week's availability is unusual enough that one ordering dead-ends.
 */
const ATTEMPTS = 4;

/**
 * Ruin-and-recreate rounds run after those attempts, on the best roster so
 * far. Each is one re-solve of a partly-cleared week, so they are cheap; the
 * loop stops early the moment a zero-cost roster appears.
 */
const RUIN_ROUNDS = 30;

/** Deterministic jitter, so the same week always produces the same roster. */
function pseudoRandom(seedValue: number): () => number {
  let x = seedValue * 2654435761;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 1000) / 1000;
  };
}

/**
 * Cost of everything that is a preference rather than a hard rule. Lower is
 * better; the improvement pass hill-climbs on this.
 *
 * Open/close imbalance dominates. Across a week there are 7 openings and 9
 * closings shared between roughly four people, so a spread of two-and-two per
 * person is reachable and a difference beyond one is a real unfairness rather
 * than rounding. Wednesday and under-minimum hours are weighted below it —
 * they matter, but not at the price of giving somebody a week of only closes.
 */
function softCost(roster: Roster, week: WeekAvailability = {}): number {
  let cost = 0;
  for (const staff of STAFF) {
    if (!staff.auto) continue;
    // Somebody unavailable all week isn't short of hours, they're away.
    if (maxComfortableDays(staff, week) === 0) continue;

    const units = assignedUnits(roster, staff.id);

    // Deliberately evaluated even at zero units. Skipping empty-handed staff
    // hid the very case this term exists for: Celina would report her day,
    // get left out of the roster entirely, and register no cost at all —
    // while the shift she should have taken pushed somebody else to a sixth
    // day.
    if (units < staff.minUnits) cost += (staff.minUnits - units) * 4;
    if (units === 0) continue;

    const opens = countKind(roster, staff.id, "open");
    const closes = countKind(roster, staff.id, "close");
    cost += Math.max(0, Math.abs(opens - closes) - 1) * 6;

    // Six days on is what staff actually feel, and it is avoidable without
    // touching anyone's weekly hours: seven units fit into five days as two
    // `12-22` plus three singles. Weighted like a lopsided week rather than
    // above it, so the fix never comes at the cost of somebody's fair split.
    cost += Math.max(0, daysWorked(roster, staff.id) - COMFORTABLE_DAYS) * 7;
  }
  for (const key of ["wed-open-0", "wed-mid-0"]) {
    const id = roster[key];
    if (id && id !== "hanna" && id !== "karen") cost += 3;
  }
  return cost;
}

/**
 * Hill-climb by swapping pairs of assignments. The backtracking search returns
 * the first roster that satisfies every hard rule, and with capacity this
 * tight that roster is largely forced — it regularly hands one person four
 * closings and one opening. Re-solving with different tie-breaking barely
 * moves it, because the slot ordering is deterministic. Swapping two people
 * between two already-legal slots explores exactly the axis the search cannot.
 *
 * Only swaps that keep the roster free of hard violations are accepted, so
 * this can improve fairness but never at the cost of a rule.
 */
function improve(roster: Roster, ctx: RuleContext, locked: Set<string>): Roster {
  const current = { ...roster };
  let cost = softCost(current, ctx.week);
  const ids = SLOTS.map(slotId);

  for (let pass = 0; pass < 6; pass++) {
    let improved = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i];
        const b = ids[j];
        if (locked.has(a) || locked.has(b)) continue;
        const pa = current[a];
        const pb = current[b];
        if (!pa || !pb || pa === pb) continue;

        current[a] = pb;
        current[b] = pa;
        const hard = findViolations(current, ctx).some((v) => v.severity === "hard");
        const next = hard ? Infinity : softCost(current, ctx.week);
        if (next < cost) {
          cost = next;
          improved = true;
        } else {
          current[a] = pa;
          current[b] = pb;
        }
      }
    }
    if (!improved) break;
  }
  return current;
}

/**
 * Tear out part of a finished roster and rebuild it.
 *
 * Swapping two people between two slots cannot reach every improvement. The
 * case that forced this: Celina reports a day, the search fills the week
 * without her, and putting her in requires a three-way chain — Celina takes a
 * mid, the person displaced picks up someone else's single shift, and that
 * person needs a different mid to keep their hours. No pairwise move gets
 * there, so the roster sits in a local optimum with Celina unused and somebody
 * else on a sixth day.
 *
 * Clearing a slice and re-solving lets the search find those chains. Removal
 * is biased towards whoever currently costs the most, since that is the part
 * worth rebuilding.
 */
function ruinAndRecreate(
  roster: Roster,
  ctx: RuleContext,
  locked: Set<string>,
  round: number,
): Roster {
  const rand = pseudoRandom(round * 7919 + 13);
  const worst = [...STAFF]
    .filter((s) => s.auto)
    .map((s) => ({
      id: s.id,
      cost:
        Math.max(0, daysWorked(roster, s.id) - COMFORTABLE_DAYS) * 7 +
        Math.max(0, s.minUnits - assignedUnits(roster, s.id)) * 4,
    }))
    .sort((a, b) => b.cost - a.cost)[0];

  const kept: Roster = {};
  for (const slot of SLOTS) {
    const key = slotId(slot);
    const id = roster[key];
    if (!id) continue;
    if (locked.has(key)) {
      kept[key] = id;
      continue;
    }
    // Always free the worst-off person's shifts, plus a scattering of others
    // so the rebuild has room to reroute around them.
    const drop = (worst && id === worst.id) || rand() < 0.35;
    if (!drop) kept[key] = id;
  }
  return kept;
}

export function autoSchedule(ctx: RuleContext, seed: Roster = {}): ScheduleResult {
  const locked = new Set(Object.keys(seed).filter((k) => seed[k]));
  let best: ScheduleResult | null = null;
  let bestScore = Infinity;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const raw = solveOnce(ctx, seed, attempt);

    // Improve regardless of whether the week filled. Running this only on
    // complete rosters skipped it exactly when it was needed most: a week
    // that can't be filled is the tightest one, and the raw search returned
    // things like Hanna on all seven openings and none of the closings.
    const roster = improve(raw.roster, ctx, locked);
    const unfilled = unfilledSlots(roster);
    const result: ScheduleResult = {
      roster,
      unfilled,
      complete: unfilled.length === 0,
    };

    // Filling the week dominates; fairness breaks ties among equally full
    // rosters. Weighting unfilled far above softCost keeps a fuller roster
    // ahead of a fairer-but-emptier one.
    const score = result.unfilled.length * 10_000 + softCost(result.roster, ctx.week);
    if (score < bestScore) {
      bestScore = score;
      best = result;
    }
    if (bestScore === 0) break;
  }

  // Ruin-and-recreate rounds on top of the best roster so far, for the
  // improvements pairwise moves can't reach.
  for (let round = 0; round < RUIN_ROUNDS && bestScore > 0 && best; round++) {
    const partial = ruinAndRecreate(best.roster, ctx, locked, round);
    const rebuilt = solveOnce(ctx, partial, round + 100);
    const roster = improve(rebuilt.roster, ctx, locked);
    const unfilled = unfilledSlots(roster);
    const score = unfilled.length * 10_000 + softCost(roster, ctx.week);
    if (score < bestScore) {
      bestScore = score;
      best = { roster, unfilled, complete: unfilled.length === 0 };
    }
  }

  return best ?? { roster: { ...seed }, unfilled: unfilledSlots(seed), complete: false };
}

function solveOnce(ctx: RuleContext, seed: Roster, attempt: number): ScheduleResult {
  const pool = STAFF.filter((s) => s.auto);
  const rand = pseudoRandom(attempt + 1);
  const state = emptyState();

  // Seeded slots are Stan's manual picks. They are placed without a rule check
  // — he may have overridden something knowingly — but they do constrain
  // everything the scheduler adds afterwards.
  for (const slot of SLOTS) {
    const id = seed[slotId(slot)];
    if (id) place(state, slot, id);
  }

  let best: Roster = { ...state.roster };
  let bestFilled = Object.keys(best).length;
  let steps = 0;

  // Slots this branch has given up on. A week can be genuinely short — one
  // person off on a day only three people can work leaves a shift nobody can
  // take — and the rest of the week still has to be rostered. Without this the
  // search treated a single impossible slot as total failure and returned
  // whatever prefix it had reached, so one day of leave emptied the whole grid.
  const skipped = new Set<string>();

  function solve(): boolean {
    if (steps++ > MAX_STEPS) return false;

    const remaining = SLOTS.filter(
      (s) => !state.roster[slotId(s)] && !skipped.has(slotId(s)),
    );
    if (remaining.length === 0) return true;

    // Most-constrained slot first. This is what stops the scheduler spending
    // its flexible staff on Monday and finding on Saturday that only Elle is
    // left and she cannot open.
    let target = remaining[0];
    let candidates = pool.filter((s) => fits(s, target, state, ctx));
    for (const slot of remaining.slice(1)) {
      const c = pool.filter((s) => fits(s, slot, state, ctx));
      if (c.length < candidates.length) {
        target = slot;
        candidates = c;
        if (c.length === 0) break;
      }
    }

    for (const staff of rank(candidates, target, state, attempt === 0 ? null : rand)) {
      place(state, target, staff.id);
      const filled = Object.keys(state.roster).length;
      if (filled > bestFilled) {
        bestFilled = filled;
        best = { ...state.roster };
      }
      if (solve()) return true;
      unplace(state, target, staff.id);
    }

    // Every candidate failed, or there were none. Leaving it empty is tried
    // last so a fillable slot is never abandoned while an option remains.
    const id = slotId(target);
    skipped.add(id);
    if (solve()) {
      const filled = Object.keys(state.roster).length;
      if (filled > bestFilled) {
        bestFilled = filled;
        best = { ...state.roster };
      }
      return true;
    }
    skipped.delete(id);
    return false;
  }

  const solved = solve();
  const roster = solved ? state.roster : best;
  const unfilled = unfilledSlots(roster);
  return { roster, unfilled, complete: unfilled.length === 0 };
}

/**
 * Order candidates so the fairest choice is tried first. Backtracking can walk
 * past it, but the first branch usually holds, so this ordering is what
 * actually produces the even spread — there is no separate balancing pass.
 */
function rank(
  candidates: Staff[],
  slot: Slot,
  state: State,
  rand: (() => number) | null,
): Staff[] {
  // Attempt 0 is the pure heuristic; later attempts perturb it so the search
  // explores orderings the strict ranking would never reach. The jitter is
  // small enough that it only reorders near-ties.
  const jitter = rand ? () => (rand() - 0.5) * 3 : () => 0;
  const scored = candidates.map((s) => ({ s, v: score(s, slot, state) + jitter() }));
  return scored.sort((a, b) => a.v - b.v).map((x) => x.s);
}

function score(staff: Staff, slot: Slot, state: State): number {
  const units = state.units.get(staff.id) ?? 0;

  // Being short of the weekly minimum pulls a person up the list, but only
  // as one term among several. It used to be weighted a hundred times the
  // others, which made it lexicographic: Hanna's min and max are both 7, so
  // her shortfall stayed large until she was full and she was picked for
  // every early slot — which meant all seven openings. Once she held every
  // opening no single swap could rebalance her either, because taking any
  // closing would collide with the next morning's opening she also held.
  const shortfall = Math.max(0, staff.minUnits - units);

  // Then whoever is least loaded as a fraction of their own cap. Comparing
  // raw units would starve Eugenia (cap 6) against Hanna (cap 7) even when
  // Eugenia is proportionally busier.
  const load = units / Math.max(1, staff.maxUnits);

  // Then open/close balance — the rule about nobody having a week of only
  // openings or only closings.
  let balance = 0;
  if (slot.kind === "open" || slot.kind === "close") {
    const opens = daysOf(state.opens, staff.id).size;
    const closes = daysOf(state.closes, staff.id).size;
    balance = slot.kind === "open" ? opens - closes : closes - opens;
  }

  // Steer away from a sixth day while placing, not only when repairing
  // afterwards: the swap pass can move who works a day but never reduce how
  // many days are staffed, so a roster that spreads one person over six days
  // is hard to unpick once built.
  const dayLoad = daysOf(state.busy, staff.id).size;
  const sixthDay = dayLoad >= COMFORTABLE_DAYS ? (dayLoad - COMFORTABLE_DAYS + 1) * 8 : 0;

  // Wednesday daytime leans to Hanna and Karen. Weighted above the load term
  // so it survives a busy Hanna — it is a stated preference, not a tiebreak.
  const wed =
    slot.day === "wed" && (slot.kind === "open" || slot.kind === "mid")
      ? staff.id === "hanna" || staff.id === "karen"
        ? -12
        : 0
      : 0;

  return -shortfall * 6 + load * 10 + balance * 7 + sixthDay + wed;
}

export type StaffLoad = {
  staff: Staff;
  units: number;
  opens: number;
  mids: number;
  closes: number;
};

export function staffLoads(roster: Roster): StaffLoad[] {
  return STAFF.map((staff) => ({
    staff,
    units: assignedUnits(roster, staff.id),
    opens: countKind(roster, staff.id, "open"),
    mids: countKind(roster, staff.id, "mid"),
    closes: countKind(roster, staff.id, "close"),
  })).filter((l) => l.units > 0);
}

export function demandUnits(): number {
  return SLOTS.reduce((n, s) => n + SHIFT_UNITS[s.kind], 0);
}
