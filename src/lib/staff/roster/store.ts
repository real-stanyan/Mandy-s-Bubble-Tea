import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import {
  allSlots,
  slotId,
  type ProfileOverrides,
  type Roster,
  type ShiftKind,
  type WeekAvailability,
  type Weekday,
} from "./model";
import { shiftWeek } from "./week";

// Server-side read for the roster page. The page is a Server Component, so it
// loads the week directly rather than having the browser fetch after mount —
// no loading flash, no effect, and the week arrives as props.

export type StoredWeek = {
  roster: Roster;
  availability: WeekAvailability;
  pinned: string[];
  updatedAt: string | null;
  updatedBy: string | null;
};

export type LoadResult =
  | { status: "ok"; week: StoredWeek }
  /** Migration 006 hasn't been applied yet. */
  | { status: "needs-migration" }
  | { status: "error"; message: string };

/**
 * A missing table arrives two different ways: Postgres raises `42P01`, but
 * PostgREST usually answers from its schema cache first and returns `PGRST205`
 * with a "could not find the table" message instead. Matching only the
 * Postgres code meant the setup notice never appeared — the page showed a raw
 * database error instead of "run migration 006".
 */
function isMissingTable(error: { code?: string; message?: string }): boolean {
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /could not find the table/i.test(error.message ?? "");
}

export const EMPTY_WEEK: StoredWeek = {
  roster: {},
  availability: {},
  pinned: [],
  updatedAt: null,
  updatedBy: null,
};

/**
 * Who closed on the Sunday before this week.
 *
 * The "no opening the morning after closing" rule is the whole reason this
 * exists. Inside one week it can be checked from the grid, but Monday's
 * previous night lives in the week before, which a per-week grid never sees —
 * so the one turnaround most likely to be missed was the only one nobody
 * checked. Both Sunday closing slots count, including Twinkle's.
 *
 * A missing previous week is not an error: the first week ever rostered has no
 * predecessor, and neither does a week whose predecessor was never saved.
 */
export async function loadPreviousSundayClosers(weekKey: string): Promise<string[]> {
  const previous = shiftWeek(weekKey, -1);
  const { data, error } = await getSupabaseAdmin()
    .from("staff_rosters")
    .select("roster")
    .eq("week_key", previous)
    .maybeSingle();

  if (error || !data) return [];
  const roster = (data as { roster?: Roster }).roster ?? {};
  return allSlots()
    .filter((s) => s.day === "sun" && s.kind === "close")
    .map((s) => roster[slotId(s)])
    .filter((id): id is string => Boolean(id));
}

/**
 * The staff profiles in force for a given week.
 *
 * Overrides are effective-from, not per-week: "Elle can do more from the 17th"
 * is one row and every week after inherits it. Resolving means taking, per
 * person, the newest row at or before this week — so weeks before a change
 * keep the shape they actually had, and a roster from back then doesn't light
 * up with violations because someone's hours changed later.
 *
 * No rows, or a missing table, means the code defaults. Nothing here is worth
 * failing a page render over.
 */
export async function loadStaffProfiles(weekKey: string): Promise<ProfileOverrides> {
  const { data, error } = await getSupabaseAdmin()
    .from("staff_profile_overrides")
    .select("staff_id,effective_from,days,kinds,min_units,max_units")
    .lte("effective_from", weekKey)
    .order("effective_from", { ascending: true });

  if (error || !data) return {};

  // Ascending order means a later row simply overwrites an earlier one, which
  // leaves the newest effective row per person.
  const out: ProfileOverrides = {};
  for (const row of data as Array<{
    staff_id: string;
    days: Weekday[];
    kinds: ShiftKind[];
    min_units: number;
    max_units: number;
  }>) {
    out[row.staff_id] = {
      days: row.days,
      kinds: row.kinds,
      minUnits: row.min_units,
      maxUnits: row.max_units,
    };
  }
  return out;
}

export async function loadWeek(weekKey: string): Promise<LoadResult> {
  const { data, error } = await getSupabaseAdmin()
    .from("staff_rosters")
    .select("*")
    .eq("week_key", weekKey)
    .maybeSingle();

  if (error) {
    // Migrations here are applied by hand in the Supabase dashboard, so a
    // deploy can land before the table exists. Distinguished from a real
    // failure so the page can show a setup notice instead of "roster lost".
    if (isMissingTable(error)) return { status: "needs-migration" };
    return { status: "error", message: error.message };
  }

  const row = data as {
    roster?: Roster;
    availability?: WeekAvailability;
    pinned?: string[];
    updated_at?: string;
    updated_by?: string | null;
  } | null;

  return {
    status: "ok",
    week: {
      roster: row?.roster ?? {},
      availability: row?.availability ?? {},
      pinned: row?.pinned ?? [],
      updatedAt: row?.updated_at ?? null,
      updatedBy: row?.updated_by ?? null,
    },
  };
}
