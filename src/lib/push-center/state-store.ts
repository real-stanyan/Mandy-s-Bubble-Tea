// Push Center — the push_customer_state table and its scan cursor. Takes the
// Supabase client as an argument so the backfill script can drive it too.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomerStateRow } from "./customer-state";

export const STATE_TABLE = "push_customer_state";
/** app_settings row: where the incremental scan got to. */
export const CURSOR_KEY = "push_state_cursor";

export type StateCursor = {
  /** ISO — orders created at or before this instant have been folded in. */
  cursor: string;
  lastRun?: {
    at: string;
    orders: number;
    customers: number;
    window: { startAt: string; endAt: string };
  };
};

const PAGE = 1000;

export async function loadAllStates(admin: SupabaseClient): Promise<Map<string, CustomerStateRow>> {
  const out = new Map<string, CustomerStateRow>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from(STATE_TABLE)
      .select("*")
      .order("customer_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${STATE_TABLE} page ${from}: ${error.message}`);
    for (const row of (data ?? []) as CustomerStateRow[]) out.set(row.customer_id, row);
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function loadStates(admin: SupabaseClient, ids: string[]): Promise<Map<string, CustomerStateRow>> {
  const out = new Map<string, CustomerStateRow>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await admin.from(STATE_TABLE).select("*").in("customer_id", chunk);
    if (error) throw new Error(`${STATE_TABLE} in(): ${error.message}`);
    for (const row of (data ?? []) as CustomerStateRow[]) out.set(row.customer_id, row);
  }
  return out;
}

export async function upsertStates(admin: SupabaseClient, rows: CustomerStateRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin
      .from(STATE_TABLE)
      .upsert(rows.slice(i, i + 500), { onConflict: "customer_id" });
    if (error) throw new Error(`${STATE_TABLE} upsert: ${error.message}`);
  }
}

export async function readCursor(admin: SupabaseClient): Promise<StateCursor | null> {
  const { data, error } = await admin.from("app_settings").select("value").eq("key", CURSOR_KEY).maybeSingle();
  if (error) throw new Error(`app_settings ${CURSOR_KEY}: ${error.message}`);
  const v = data?.value as StateCursor | undefined;
  return v && typeof v.cursor === "string" ? v : null;
}

export async function writeCursor(admin: SupabaseClient, value: StateCursor): Promise<void> {
  const { error } = await admin
    .from("app_settings")
    .upsert({ key: CURSOR_KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(`app_settings ${CURSOR_KEY} write: ${error.message}`);
}

export type StateSummary = { rows: number; cursor: StateCursor | null; tableMissing: boolean };

export async function stateSummary(admin: SupabaseClient): Promise<StateSummary> {
  const { count, error } = await admin.from(STATE_TABLE).select("customer_id", { count: "exact", head: true });
  if (error) {
    // 42P01 = relation does not exist: the migration has not been applied.
    if (error.code === "42P01" || /does not exist/i.test(error.message)) {
      return { rows: 0, cursor: null, tableMissing: true };
    }
    throw new Error(`${STATE_TABLE} count: ${error.message}`);
  }
  return { rows: count ?? 0, cursor: await readCursor(admin), tableMissing: false };
}
