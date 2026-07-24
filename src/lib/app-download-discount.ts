import "server-only";
import type { Square } from "square";
import { getSupabaseAdmin } from "./supabase-server";

// App-download promo: a one-order, whole-order percentage-off ticket claimed on
// the web by phone number, then redeemed later once the customer signs into the
// app. The grant is keyed by phone (E.164) — the only identity available at
// web-claim time — so no install attribution is needed: the signed-in app user
// carries phone_e164 on their profile, which resolves straight to the grant.
// Mirrors ig-follow-discount.ts (claim/status shape) and flash-promo.ts (money
// semantics + one-shot burn).

export interface AppDownloadDiscountStatus {
  available: boolean;
  percentage: number;
  claimedAt: string | null;
  redeemedAt: string | null;
}

const DISABLED: AppDownloadDiscountStatus = {
  available: false,
  percentage: 0,
  claimedAt: null,
  redeemedAt: null,
};

/**
 * Mint a one-order 20%-off ticket for a phone (E.164). Idempotent per phone —
 * a second claim when the row already exists returns alreadyClaimed=true and
 * changes nothing. No auth (the web claimer isn't signed in yet); the per-phone
 * primary key is the entire dedup defence. Errors are swallowed and surface as
 * alreadyClaimed=false so the caller can retry on the next request.
 */
export async function claimAppDownloadDiscount(
  phoneE164: string,
): Promise<{ alreadyClaimed: boolean }> {
  try {
    const { error, count } = await getSupabaseAdmin()
      .from("app_download_grants")
      .upsert(
        { phone_e164: phoneE164 },
        { onConflict: "phone_e164", ignoreDuplicates: true, count: "exact" },
      );
    if (error) throw error;
    return { alreadyClaimed: count === 0 };
  } catch (err) {
    console.error("[app-download] claim failed:", err);
    return { alreadyClaimed: false };
  }
}

/**
 * Ticket state for a phone. Always returns a value — never throws. Disabled
 * shape on a missing row or any error. `available` is true only while the
 * ticket is unredeemed.
 */
export async function getAppDownloadDiscountStatus(
  phoneE164: string,
): Promise<AppDownloadDiscountStatus> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("app_download_grants")
      .select("percentage,claimed_at,redeemed_at")
      .eq("phone_e164", phoneE164)
      .maybeSingle();
    if (error) throw error;
    if (!data) return DISABLED;
    return {
      available: data.redeemed_at == null,
      percentage: data.percentage ?? 20,
      claimedAt: data.claimed_at ?? null,
      redeemedAt: data.redeemed_at ?? null,
    };
  } catch (err) {
    console.error("[app-download] status failed:", err);
    return DISABLED;
  }
}

/**
 * One-shot burn via the consume_app_download_discount RPC (update-if-unredeemed,
 * so double-taps and replayed webhooks consume at most once). Returns
 * consumedCount=1 only on the call that actually flips redeemed_at.
 */
export async function consumeAppDownloadDiscount(
  phoneE164: string,
  orderId: string,
  customerId: string | null,
): Promise<{ consumedCount: number }> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc(
      "consume_app_download_discount",
      {
        p_phone: phoneE164,
        p_order_id: orderId,
        p_customer_id: customerId,
      },
    );
    if (error) throw error;
    const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
    return { consumedCount: Number(row?.consumed_count ?? 0) };
  } catch (err) {
    console.error("[app-download] consume failed:", err);
    return { consumedCount: 0 };
  }
}

/**
 * The recipient phone stamped onto an order's PICKUP fulfillment at create time
 * (see /api/orders). This is the burn key for both settle paths — the payment
 * route (pickup) and the driver-accept path (delivery) — since the grant is
 * phone-keyed, not customer-keyed.
 */
export function appDownloadPhoneFromOrder(
  order: Square.Order,
): string | null {
  return order.fulfillments?.[0]?.pickupDetails?.recipient?.phoneNumber ?? null;
}
