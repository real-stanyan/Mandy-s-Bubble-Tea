import "server-only";
import { getSupabaseAdmin } from "./supabase-server";

export interface IgFollowDiscountStatus {
  available: boolean;
  percentage: number;
  drinksRemaining: number;
  claimedAt: string | null;
  redeemedAt: string | null;
}

const DISABLED: IgFollowDiscountStatus = {
  available: false,
  percentage: 0,
  drinksRemaining: 0,
  claimedAt: null,
  redeemedAt: null,
};

/**
 * Mint a 10% off ticket for the given Square customer. Idempotent: a
 * second call when the row already exists returns alreadyClaimed=true.
 * Errors are swallowed and surface as alreadyClaimed=false (caller can
 * retry on the next request).
 */
export async function claimIgFollowDiscount(
  customerId: string,
): Promise<{ alreadyClaimed: boolean }> {
  try {
    const { error, count } = await getSupabaseAdmin()
      .from("ig_follow_discounts")
      .upsert(
        { customer_id: customerId },
        { onConflict: "customer_id", ignoreDuplicates: true, count: "exact" },
      );
    if (error) throw error;
    return { alreadyClaimed: count === 0 };
  } catch (err) {
    console.error("[ig-follow] claim failed:", err);
    return { alreadyClaimed: false };
  }
}

/**
 * Returns ticket state for the customer. Always returns a value — never
 * throws. Disabled shape on missing row or any error.
 */
export async function getIgFollowDiscountStatus(
  customerId: string,
): Promise<IgFollowDiscountStatus> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("ig_follow_discounts")
      .select("drinks_remaining,percentage,claimed_at,redeemed_at")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return DISABLED;
    const remaining = data.drinks_remaining ?? 0;
    return {
      available: remaining > 0,
      percentage: data.percentage ?? 10,
      drinksRemaining: remaining,
      claimedAt: data.claimed_at ?? null,
      redeemedAt: data.redeemed_at ?? null,
    };
  } catch (err) {
    console.error("[ig-follow] status failed:", err);
    return DISABLED;
  }
}

/**
 * Atomically decrements drinks_remaining via the consume_ig_follow_discount
 * RPC. Stamps redeemed_at + order_id when the ticket hits zero.
 */
export async function consumeIgFollowDiscount(
  customerId: string,
  orderId: string,
  count: number,
): Promise<{ consumedCount: number; drinksRemaining: number }> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc(
      "consume_ig_follow_discount",
      {
        p_customer_id: customerId,
        p_order_id: orderId,
        p_count: count,
      },
    );
    if (error) throw error;
    const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
    if (!row) return { consumedCount: 0, drinksRemaining: 0 };
    return {
      consumedCount: Number(row.consumed_count ?? 0),
      drinksRemaining: Number(row.drinks_remaining ?? 0),
    };
  } catch (err) {
    console.error("[ig-follow] consume failed:", err);
    return { consumedCount: 0, drinksRemaining: 0 };
  }
}
