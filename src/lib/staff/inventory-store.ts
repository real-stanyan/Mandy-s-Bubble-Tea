import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { brisbaneDate } from "./stock-history";
import { readLastCount } from "./stock-history-store";
import {
  ensureCosts,
  ensureShopLines,
  parseState,
  recordShopCount,
  seedState,
  shopCountFromRaw,
  type InventoryState,
} from "./inventory";

// Where the warehouse inventory lives.
//
// One JSON row in `app_settings`, like the last-count snapshot and the
// threshold overrides before it. A proper set of tables (items, pickups,
// counts) is the better shape and worth doing when a migration credential is
// on hand; a row in an existing table needs no DDL, so this works today. The
// document is small — sixty items, a few hundred pickups, four months of
// daily counts — and every write replaces the whole thing, which is fine for
// one owner editing from one phone.

const KEY = "warehouse_inventory";

/** The current state, seeding it on first use. The seed carries the last
 *  shop count across so usage can be measured from the very next check. */
export async function readInventory(now: Date = new Date()): Promise<InventoryState> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("app_settings")
      .select("value")
      .eq("key", KEY)
      .maybeSingle();
    if (!error && data) {
      const parsed = parseState(data.value);
      if (parsed) {
        // Lines removed from the warehouse (or added to stocklist.ts since)
        // come back as shop-only rows so the pickup list stays complete.
        const ensured = ensureShopLines(parsed, now);
        // One-off: the 2026-09-05 unit costs and the off-sheet cost items.
        const costed = ensureCosts(ensured.state, now);
        if (ensured.added > 0 || costed.changed) await writeInventory(costed.state);
        return costed.state;
      }
    }
  } catch (e) {
    console.error("[inventory] could not read", e);
  }
  const last = await readLastCount();
  const seeded = seedState(now, last ? shopCountFromRaw(last.date, last.counts) : null);
  await writeInventory(seeded);
  return seeded;
}

/** Replace the stored state. Returns false rather than throwing so the UI can
 *  say "not saved" instead of crashing. */
export async function writeInventory(state: InventoryState): Promise<boolean> {
  try {
    const { error } = await getSupabaseAdmin()
      .from("app_settings")
      .upsert(
        { key: KEY, value: state, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    if (error) {
      console.error("[inventory] could not save", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[inventory] could not save", e);
    return false;
  }
}

/**
 * Fold a submitted stock check into the inventory's history. Called from the
 * stock-check route after the count is recorded; never throws, because the
 * count has already been emailed and a bookkeeping failure must not turn
 * that into an error the staff member sees.
 */
export async function recordShopCountFromCheck(
  raw: Record<string, string>,
  now: Date,
): Promise<void> {
  try {
    const state = await readInventory(now);
    const next = recordShopCount(state, shopCountFromRaw(brisbaneDate(now), raw));
    await writeInventory(next);
  } catch (e) {
    console.error("[inventory] could not record shop count", e);
  }
}
