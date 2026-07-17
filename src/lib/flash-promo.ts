import "server-only";
import { getSupabaseAdmin } from "./supabase-server";
import { brisbaneYmd } from "./brisbane-date";

/**
 * The flash promo key rides inside the order discount uid
 * ("flash-promo:<key>") because the Square metadata budget is already at
 * its 10-entry worst case. This parses it back out of an order's discounts.
 */
export function flashPromoKeyFromDiscounts(
  discounts: Array<{ uid?: string | null }> | null | undefined,
): string | null {
  for (const d of discounts ?? []) {
    if (d.uid?.startsWith("flash-promo:")) {
      const key = d.uid.slice("flash-promo:".length);
      if (key) return key;
    }
  }
  return null;
}

export interface FlashPromoStatus {
  available: boolean;
  key: string | null;
  percentage: number;
}

const DISABLED: FlashPromoStatus = {
  available: false,
  key: null,
  percentage: 0,
};

/**
 * The flash promo active on the current Brisbane calendar day, if any.
 * Errors are swallowed (returns DISABLED) — a status hiccup must never
 * block checkout, it just hides the promo for that request.
 */
export async function getActiveFlashPromo(
  now = new Date(),
): Promise<FlashPromoStatus> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("flash_promos")
      .select("key,percentage")
      .eq("active", true)
      .eq("promo_date", brisbaneYmd(now))
      .maybeSingle();
    if (error) throw error;
    if (!data) return DISABLED;
    return { available: true, key: data.key, percentage: data.percentage };
  } catch (err) {
    console.error("[flash-promo] active lookup failed:", err);
    return DISABLED;
  }
}

/**
 * Promo status for one customer: active today AND not yet redeemed by them.
 */
export async function getFlashPromoStatus(
  customerId: string,
  now = new Date(),
): Promise<FlashPromoStatus> {
  const promo = await getActiveFlashPromo(now);
  if (!promo.available || !promo.key) return DISABLED;
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("flash_promo_redemptions")
      .select("customer_id")
      .eq("promo_key", promo.key)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error) throw error;
    if (data) return DISABLED;
    return promo;
  } catch (err) {
    console.error("[flash-promo] status failed:", err);
    return DISABLED;
  }
}

/**
 * One-shot burn via the consume_flash_promo RPC (insert-if-absent, so
 * double-taps and replayed webhooks consume at most once).
 */
export async function consumeFlashPromo(
  promoKey: string,
  customerId: string,
  orderId: string,
): Promise<{ consumedCount: number }> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc(
      "consume_flash_promo",
      {
        p_promo_key: promoKey,
        p_customer_id: customerId,
        p_order_id: orderId,
      },
    );
    if (error) throw error;
    const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
    return { consumedCount: Number(row?.consumed_count ?? 0) };
  } catch (err) {
    console.error("[flash-promo] consume failed:", err);
    return { consumedCount: 0 };
  }
}
