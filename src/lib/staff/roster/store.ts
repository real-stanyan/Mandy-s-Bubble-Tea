import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import type { Roster, WeekAvailability } from "./model";

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
