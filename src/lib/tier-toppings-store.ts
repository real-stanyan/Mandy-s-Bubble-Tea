import "server-only";
import { DIAMOND_MONTHLY_FREE_TOPPINGS } from "@/lib/membership-tier";
import { getSupabaseAdmin } from "./supabase-server";

export type ToppingAllowanceStatus = {
  usedCount: number;
  remaining: number;
  monthKey: string;
};

/** Fail-safe read: any error → remaining 0 (no free toppings, never over-grant). */
export async function getToppingAllowanceStatus(
  customerId: string,
  monthKey: string,
): Promise<ToppingAllowanceStatus> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("tier_topping_usage")
      .select("used_count")
      .eq("customer_id", customerId)
      .eq("month_key", monthKey)
      .maybeSingle();
    if (error) throw error;
    const used = Number(data?.used_count ?? 0);
    return {
      usedCount: used,
      remaining: Math.max(0, DIAMOND_MONTHLY_FREE_TOPPINGS - used),
      monthKey,
    };
  } catch (err) {
    console.error("[tier-toppings] status read failed:", err);
    return { usedCount: 0, remaining: 0, monthKey };
  }
}

/** Fail-safe consume: any error → consumedCount 0 (ledger under-counts, never over). */
export async function consumeToppingAllowance(
  customerId: string,
  monthKey: string,
  count: number,
  orderId: string,
): Promise<{ consumedCount: number; usedCount: number }> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc(
      "consume_topping_allowance",
      {
        p_customer_id: customerId,
        p_month_key: monthKey,
        p_count: count,
        p_order_id: orderId,
      },
    );
    if (error) throw error;
    const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
    if (!row) return { consumedCount: 0, usedCount: 0 };
    return {
      consumedCount: Number(row.consumed_count ?? 0),
      usedCount: Number(row.used_count ?? 0),
    };
  } catch (err) {
    console.error("[tier-toppings] consume failed:", err);
    return { consumedCount: 0, usedCount: 0 };
  }
}
