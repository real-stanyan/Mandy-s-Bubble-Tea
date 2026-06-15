import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { RARE_LUCKY_CAT_ODDS } from "./lucky-cat";

// Live, boss-editable jackpot odds for the free-drink lucky cat. Stored in
// the shared `app_settings` table (key `lucky_cat_free_drink_odds`, value =
// the "1 in N" integer) and edited from the Admin app's settings card.
//
// Read path mirrors store-status-server.ts: a short module-level TTL cache
// so the enqueue hot path (one read per order) doesn't hit Postgres every
// time, with a hard fallback to the compiled default if the row is missing
// or the read fails.

export const FREE_DRINK_ODDS_SETTING_KEY = "lucky_cat_free_drink_odds";
const ODDS_CACHE_TTL_MS = 60_000;

let oddsCache: { value: number; fetchedAt: number } | null = null;

export function __resetFreeDrinkOddsCacheForTests(): void {
  oddsCache = null;
}

// Coerce whatever is in app_settings.value to a valid "1 in N" integer,
// falling back to the default for anything out of range / malformed.
function normalizeOdds(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return RARE_LUCKY_CAT_ODDS;
  return Math.floor(n);
}

export async function getFreeDrinkOdds(): Promise<number> {
  const now = Date.now();
  if (oddsCache && now - oddsCache.fetchedAt < ODDS_CACHE_TTL_MS) {
    return oddsCache.value;
  }
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("app_settings")
      .select("value")
      .eq("key", FREE_DRINK_ODDS_SETTING_KEY)
      .maybeSingle();
    if (error) throw error;
    const value =
      data?.value === undefined || data?.value === null
        ? RARE_LUCKY_CAT_ODDS
        : normalizeOdds(data.value);
    oddsCache = { value, fetchedAt: now };
    return value;
  } catch {
    // Don't cache failures aggressively — but a short cache avoids
    // hammering a degraded DB on a busy order burst.
    oddsCache = { value: RARE_LUCKY_CAT_ODDS, fetchedAt: now };
    return RARE_LUCKY_CAT_ODDS;
  }
}
