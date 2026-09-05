import "server-only";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { brisbaneYmd } from "@/lib/brisbane-date";
import { addDaysYmd, eachDay } from "./finance";

// Square takings per Brisbane day, for the Finance page.
//
// Summing orders is the only way to get a day's revenue out of Square, and a
// day is 300–400 orders, so the answer is cached per day in `app_settings`
// (key square_daily_revenue) and only days that are missing — or the last
// two, which can still change — are fetched. The first request for a long
// range is slow; after that it is one row read.

const KEY = "square_daily_revenue";

type DayTotal = { amount: number; orders: number };
type Cache = { days: Record<string, DayTotal>; updatedAt: string };

async function readCache(): Promise<Cache> {
  try {
    const { data } = await getSupabaseAdmin().from("app_settings").select("value").eq("key", KEY).maybeSingle();
    const v = data?.value as Partial<Cache> | undefined;
    if (v && typeof v.days === "object" && v.days) return { days: v.days as Record<string, DayTotal>, updatedAt: v.updatedAt ?? "" };
  } catch (e) {
    console.error("[square-revenue] could not read cache", e);
  }
  return { days: {}, updatedAt: "" };
}

async function writeCache(cache: Cache): Promise<void> {
  try {
    await getSupabaseAdmin()
      .from("app_settings")
      .upsert({ key: KEY, value: cache, updated_at: new Date().toISOString() }, { onConflict: "key" });
  } catch (e) {
    console.error("[square-revenue] could not write cache", e);
  }
}

/** Completed-order totals (AUD, incl. GST, after discounts) for every
 *  Brisbane day in [from, to], fetched from Square. */
async function fetchRange(from: string, to: string): Promise<Record<string, DayTotal>> {
  const out: Record<string, DayTotal> = {};
  for (const d of eachDay(from, to)) out[d] = { amount: 0, orders: 0 };
  let cursor: string | undefined;
  do {
    const res = await squareClient.orders.search({
      locationIds: [SQUARE_LOCATION_ID],
      limit: 500,
      cursor,
      query: {
        filter: {
          stateFilter: { states: ["COMPLETED"] },
          dateTimeFilter: {
            closedAt: { startAt: `${from}T00:00:00+10:00`, endAt: `${addDaysYmd(to, 1)}T00:00:00+10:00` },
          },
        },
        sort: { sortField: "CLOSED_AT", sortOrder: "ASC" },
      },
    });
    for (const o of res.orders ?? []) {
      const when = o.closedAt ?? o.createdAt;
      if (!when) continue;
      const day = brisbaneYmd(new Date(when));
      const t = (out[day] ??= { amount: 0, orders: 0 });
      t.amount += Number(o.totalMoney?.amount ?? 0n) / 100;
      t.orders += 1;
    }
    cursor = res.cursor ?? undefined;
  } while (cursor);
  for (const t of Object.values(out)) t.amount = Math.round(t.amount * 100) / 100;
  return out;
}

/** Group a sorted list of days into contiguous [from, to] ranges. */
function ranges(days: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const d of days) {
    const last = out[out.length - 1];
    if (last && addDaysYmd(last[1], 1) === d) last[1] = d;
    else out.push([d, d]);
  }
  return out;
}

/**
 * Revenue per day for [from, to]. `today` decides which trailing days are
 * re-fetched (today and yesterday — an order closing after midnight or a
 * late refund can still move them).
 */
export async function squareRevenueByDay(
  from: string,
  to: string,
  today: string,
): Promise<{ byDay: Record<string, number>; fetchedDays: number }> {
  if (!SQUARE_LOCATION_ID) return { byDay: {}, fetchedDays: 0 };
  const cache = await readCache();
  const stale = addDaysYmd(today, -1);
  const need = eachDay(from, to).filter((d) => d <= today && (!cache.days[d] || d >= stale));
  let fetched = 0;
  for (const [a, b] of ranges(need)) {
    try {
      const got = await fetchRange(a, b);
      for (const [d, t] of Object.entries(got)) cache.days[d] = t;
      fetched += eachDay(a, b).length;
    } catch (e) {
      console.error(`[square-revenue] fetch ${a}..${b} failed`, e);
    }
  }
  if (fetched > 0) {
    cache.updatedAt = new Date().toISOString();
    await writeCache(cache);
  }
  const byDay: Record<string, number> = {};
  for (const d of eachDay(from, to)) if (cache.days[d]) byDay[d] = cache.days[d].amount;
  return { byDay, fetchedDays: fetched };
}
