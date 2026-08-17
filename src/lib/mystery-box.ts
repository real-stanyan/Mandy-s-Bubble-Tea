import "server-only";
import { getSupabaseAdmin } from "./supabase-server";
import { isMissingTableError } from "./postgrest-errors";

// Mystery box: the chat's "给我惊喜" prize draw. The SERVER rolls — odds
// live in this table and nowhere else, so neither the model nor the client
// can invent, upgrade, or re-roll a prize (Stan's spec, 2026-08-17). The
// draw happens when the customer OPENS the box (one API call), lands as a
// coupon row, and checkout's discount ladder redeems it.

export type MysteryPrize =
  | "pct5"
  | "pct10"
  | "pct15"
  | "free_topping"
  | "free_drink";

/** Stan's odds table (2026-08-17). Weights sum to 100 — the test pins it. */
export const MYSTERY_ODDS: Array<{
  prize: MysteryPrize;
  weight: number;
  percentage: number | null;
}> = [
  { prize: "pct5", weight: 40, percentage: 5 },
  { prize: "pct10", weight: 20, percentage: 10 },
  { prize: "pct15", weight: 10, percentage: 15 },
  { prize: "free_topping", weight: 25, percentage: null },
  { prize: "free_drink", weight: 5, percentage: null },
];

/** Coupon lifetime. An assumption, not a spec (Stan hasn't set one) — one
 *  constant to change when he does. */
export const COUPON_LIFETIME_DAYS = 14;

/** Customer-facing coupon names — printed on the coupon card, the rewards
 *  page, and (via the discount name) the receipt. */
export function prizeLabel(prize: MysteryPrize): string {
  switch (prize) {
    case "pct5":
      return "5% Off Your Order";
    case "pct10":
      return "10% Off Your Order";
    case "pct15":
      return "15% Off Your Order";
    case "free_topping":
      return "Free Topping";
    case "free_drink":
      return "Free Drink";
  }
}

/** Weighted roll. `roll` ∈ [0,1) injectable for tests. */
export function drawMysteryPrize(roll: number = Math.random()): MysteryPrize {
  const total = MYSTERY_ODDS.reduce((s, o) => s + o.weight, 0);
  let cursor = roll * total;
  for (const o of MYSTERY_ODDS) {
    cursor -= o.weight;
    if (cursor < 0) return o.prize;
  }
  // roll === 1 can't happen (Math.random is [0,1)), but a defensive floor
  // beats an undefined prize.
  return MYSTERY_ODDS[MYSTERY_ODDS.length - 1].prize;
}

export type OpenBoxResult =
  | { opened: true; couponId: string; prize: MysteryPrize; label: string; expiresAt: string }
  | { opened: false; reason: "already-today" | "unavailable" };

/**
 * Open today's box for a signed-in customer: roll, store, return the prize.
 * The one-a-day rule is the DATABASE's unique index on (phone, Brisbane
 * day) — a double-tap or parallel request comes back 23505 and simply never
 * drew. Table missing (migration not applied yet) degrades to "unavailable"
 * rather than a 500: the chat tells the customer the box is napping.
 */
export async function openMysteryBox(
  phoneE164: string,
  customerId: string | null,
): Promise<OpenBoxResult> {
  const prize = drawMysteryPrize();
  const spec = MYSTERY_ODDS.find((o) => o.prize === prize)!;
  const expiresAt = new Date(
    Date.now() + COUPON_LIFETIME_DAYS * 24 * 3600 * 1000,
  ).toISOString();

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("mystery_coupons")
      .insert({
        phone_e164: phoneE164,
        customer_id: customerId,
        prize,
        percentage: spec.percentage,
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (error) throw error;
    return {
      opened: true,
      couponId: (data as { id: string }).id,
      prize,
      label: prizeLabel(prize),
      expiresAt,
    };
  } catch (err) {
    const pgErr = err as { code?: string | null; message?: string };
    if (pgErr?.code === "23505") return { opened: false, reason: "already-today" };
    if (isMissingTableError(pgErr)) {
      console.error("[mystery-box] table missing — migration not applied yet");
      return { opened: false, reason: "unavailable" };
    }
    console.error("[mystery-box] open failed:", err);
    return { opened: false, reason: "unavailable" };
  }
}

/** The discount uid carries the coupon id, same trick as flash-promo.<key> —
 *  the burn paths parse it back out without touching metadata (whose 10-entry
 *  Square budget is already at worst case). */
export const MYSTERY_COUPON_UID_PREFIX = "mystery-coupon.";

export function mysteryCouponUid(id: string): string {
  return `${MYSTERY_COUPON_UID_PREFIX}${id}`;
}

export function mysteryCouponIdFromDiscounts(
  discounts: Array<{ uid?: string | null }> | null | undefined,
): string | null {
  for (const d of discounts ?? []) {
    if (d.uid?.startsWith(MYSTERY_COUPON_UID_PREFIX)) {
      return d.uid.slice(MYSTERY_COUPON_UID_PREFIX.length) || null;
    }
  }
  return null;
}

export type LiveCoupon = {
  id: string;
  prize: MysteryPrize;
  percentage: number | null;
  label: string;
  expiresAt: string;
};

/** Unredeemed, unexpired coupons for a phone — newest first. Never throws;
 *  a missing table or a dead lookup is just "no coupons". */
export async function getLiveMysteryCoupons(
  phoneE164: string,
): Promise<LiveCoupon[]> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("mystery_coupons")
      .select("id, prize, percentage, expires_at")
      .eq("phone_e164", phoneE164)
      .is("redeemed_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("drawn_at", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Array<{
      id: string;
      prize: MysteryPrize;
      percentage: number | null;
      expires_at: string;
    }>).map((row) => ({
      id: row.id,
      prize: row.prize,
      percentage: row.percentage,
      label: prizeLabel(row.prize),
      expiresAt: row.expires_at,
    }));
  } catch (err) {
    if (!isMissingTableError(err as { code?: string | null; message?: string })) {
      console.error("[mystery-box] live coupon lookup failed:", err);
    }
    return [];
  }
}

/** Atomic one-shot burn via the consume RPC. consumed=false means someone
 *  (a retry, a parallel order) already burned it — the caller treats that
 *  as "this order gets no coupon", never as an error. */
export async function consumeMysteryCoupon(
  id: string,
  phoneE164: string,
  orderId: string,
  customerId: string | null,
): Promise<{ consumed: boolean }> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc(
      "consume_mystery_coupon",
      {
        p_id: id,
        p_phone: phoneE164,
        p_order_id: orderId,
        p_customer_id: customerId,
      },
    );
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return { consumed: (row as { consumed_count?: number })?.consumed_count === 1 };
  } catch (err) {
    console.error("[mystery-box] consume failed:", err);
    return { consumed: false };
  }
}
