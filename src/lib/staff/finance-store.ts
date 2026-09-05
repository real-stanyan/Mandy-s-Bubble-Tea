import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { brisbaneDate } from "./stock-history";
import { readInventory } from "./inventory-store";
import { consumptionCostByDay } from "./inventory";
import { squareRevenueByDay } from "./square-revenue";
import {
  addDaysYmd,
  buildDaily,
  emptyFinance,
  parseFinance,
  type DailyPoint,
  type FinanceState,
} from "./finance";

// The finance ledger — DoorDash payouts, bills, wages, rent — lives in one
// JSON row in app_settings like the inventory does (no DDL available here).

const KEY = "finance_ledger";

export async function readFinance(): Promise<FinanceState> {
  try {
    const { data } = await getSupabaseAdmin().from("app_settings").select("value").eq("key", KEY).maybeSingle();
    const parsed = data ? parseFinance(data.value) : null;
    if (parsed) return parsed;
  } catch (e) {
    console.error("[finance] could not read", e);
  }
  return emptyFinance();
}

export async function writeFinance(state: FinanceState): Promise<boolean> {
  try {
    const { error } = await getSupabaseAdmin()
      .from("app_settings")
      .upsert({ key: KEY, value: state, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) {
      console.error("[finance] could not save", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[finance] could not save", e);
    return false;
  }
}

export type FinanceView = {
  from: string;
  to: string;
  today: string;
  points: DailyPoint[];
  finance: FinanceState;
  /** First day the inventory has consumption for — before it, cost is only rent/bills. */
  firstConsumptionDay: string | null;
  squareFetchedDays: number;
};

/** Everything the Finance page shows for [from, to]. */
export async function buildFinanceView(from: string, to: string, now: Date = new Date()): Promise<FinanceView> {
  const today = brisbaneDate(now);
  const [finance, inventory, square] = await Promise.all([
    readFinance(),
    readInventory(now),
    squareRevenueByDay(from, to, today),
  ]);
  const consumptionByDay = consumptionCostByDay(inventory, from, to);
  // Counted items only: override items (creamer, cups) cost the same every
  // day and would otherwise claim consumption began at the range start.
  const firstConsumptionDay = inventory.shopCounts.map((c) => c.date).sort()[0] ?? null;
  return {
    from,
    to,
    today,
    points: buildDaily({ from, to, squareByDay: square.byDay, consumptionByDay, finance }),
    finance,
    firstConsumptionDay,
    squareFetchedDays: square.fetchedDays,
  };
}

/** Default window: the last 13 weeks up to today. */
export function defaultRange(now: Date = new Date()): { from: string; to: string } {
  const to = brisbaneDate(now);
  return { from: addDaysYmd(to, -90), to };
}
