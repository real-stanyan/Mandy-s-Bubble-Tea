import "server-only";
import { getSupabaseAdmin } from "./supabase-server";
import { formatPrice } from "./utils";

// Tasting promo: one named drink at a flat "come try it" price, app-only,
// for a date window (see supabase/migrations/2026-08-07-tasting-promo.sql).
//
// This is the first ITEM-level promo in the pricing engine — welcome, IG,
// tier, flash and app-download all discount the order as a whole. The money
// is still expressed as one FIXED_AMOUNT order discount (Square's order
// create takes no per-line discount from us), sized as "what this cup costs
// today minus the tasting price".
//
// Toppings are NOT part of the tasting price: the discount is computed from
// the VARIATION price alone, so a $5 tasting cup with $1.20 of pearls is
// $6.20. That keeps the promise ("the drink is $5") true without handing out
// free toppings, and it matches how the counter would ring it up.

/**
 * The promo key rides inside the discount uid, same trick and same reason as
 * flash-promo: the Square order metadata budget is at its 10-entry worst case.
 * Separator is a DOT — Square order uids allow only alphanumerics, dots,
 * underscores and hyphens (a colon 400-rejected every flash order on
 * 2026-07-17), and promo keys are hyphenated so the first dot is unambiguous.
 */
export const TASTING_PROMO_UID_PREFIX = "tasting-promo.";

export function tastingPromoUid(key: string): string {
  return `${TASTING_PROMO_UID_PREFIX}${key}`;
}

/**
 * How many cups of the promo drink one order can take at the tasting price.
 *
 * One. The promo exists to buy a first taste, not to be the new menu price,
 * and the window is open to every app order — an uncapped tasting price would
 * let a single order take twenty cups at cost. A customer who wants two can
 * place two orders; that friction is the point.
 */
export const TASTING_CUPS_PER_ORDER = 1;

export interface TastingPromoStatus {
  available: boolean;
  key: string | null;
  productName: string | null;
  tastingPriceCents: number;
  endsAt: string | null;
}

const DISABLED: TastingPromoStatus = {
  available: false,
  key: null,
  productName: null,
  tastingPriceCents: 0,
  endsAt: null,
};

type PromoRow = {
  key: string;
  product_name: string;
  tasting_price_cents: number;
  ends_at: string;
};

/**
 * The tasting promo whose window is open right now, if any. Errors are
 * swallowed (returns DISABLED) — a status hiccup must never block checkout,
 * it just prices that one request without the promo.
 *
 * Overlapping windows are not an error: the most recently started one wins,
 * so replacing a running promo is an insert, not an edit.
 */
export async function getActiveTastingPromo(
  now = new Date(),
): Promise<TastingPromoStatus> {
  try {
    const iso = now.toISOString();
    const { data, error } = await getSupabaseAdmin()
      .from("tasting_promos")
      .select("key,product_name,tasting_price_cents,ends_at")
      .eq("active", true)
      .lte("starts_at", iso)
      .gt("ends_at", iso)
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return DISABLED;
    const row = data as PromoRow;
    return {
      available: true,
      key: row.key,
      productName: row.product_name,
      tastingPriceCents: Number(row.tasting_price_cents),
      endsAt: row.ends_at,
    };
  } catch (err) {
    console.error("[tasting-promo] active lookup failed:", err);
    return DISABLED;
  }
}

/** One promo by key, regardless of window — the send endpoint's source of
 *  truth for the money it announces. Throws: an admin clicking send deserves
 *  the real error, unlike the pricing path which fails safe to "no promo". */
export async function getTastingPromoByKey(key: string): Promise<{
  key: string;
  productName: string;
  tastingPriceCents: number;
  startsAt: string;
  endsAt: string;
  active: boolean;
  pushedAt: string | null;
} | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("tasting_promos")
    .select("key,product_name,tasting_price_cents,starts_at,ends_at,active,pushed_at")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(`getTastingPromoByKey: ${error.message}`);
  if (!data) return null;
  const row = data as PromoRow & {
    starts_at: string;
    active: boolean;
    pushed_at: string | null;
  };
  return {
    key: row.key,
    productName: row.product_name,
    tastingPriceCents: Number(row.tasting_price_cents),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    active: row.active,
    pushedAt: row.pushed_at,
  };
}

/**
 * Stamp the promo as announced. Conditional on pushed_at still being null, so
 * two admins clicking send at the same moment cannot both win — the loser
 * gets claimed=false and sends nothing.
 */
export async function claimTastingPromoPush(key: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("tasting_promos")
    .update({ pushed_at: new Date().toISOString() })
    .eq("key", key)
    .is("pushed_at", null)
    .select("key");
  if (error) throw new Error(`claimTastingPromoPush: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Release the claim so a failed send can be retried. */
export async function releaseTastingPromoPush(key: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("tasting_promos")
    .update({ pushed_at: null })
    .eq("key", key);
  if (error) throw new Error(`releaseTastingPromoPush: ${error.message}`);
}

/**
 * Default push copy for a promo, built from the row rather than typed by the
 * sender — the notification promises a price, and the only price that can be
 * honoured is the one the pricing engine reads out of this same row.
 *
 * The window is stated in whole days remaining, rounded up: "valid 5 days" on
 * the day it starts, and never "valid 0 days" while it is still live.
 */
export function tastingPromoCopy(
  promo: { productName: string; tastingPriceCents: number; endsAt: string },
  now = new Date(),
): { title: string; body: string } {
  const msLeft = new Date(promo.endsAt).getTime() - now.getTime();
  const days = Math.max(1, Math.ceil(msLeft / 86_400_000));
  return {
    title: `🧋 New Taste — ${promo.productName}`,
    body:
      `Try it for just ${formatPrice(promo.tastingPriceCents)}! ` +
      `Exclusive for app users. Valid ${days} ${days === 1 ? "day" : "days"}. Tap to order.`,
  };
}

/** One cup in the cart, as the tasting math needs to see it. */
export type TastingCup = {
  /** What the customer pays for this cup today: variation + its modifiers. */
  unitPriceCents: bigint;
  /** Variation price alone — the number the tasting price replaces. */
  basePriceCents: bigint;
  /** Catalog item name this cup came from. */
  itemName: string;
};

/** Case- and whitespace-insensitive, so "Strawberry  Matcha Milk Tea" from a
 *  hand-typed promo row still matches the catalog's spelling. */
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

export type TastingDiscount = {
  amountCents: bigint;
  cupsCovered: number;
};

/**
 * What the tasting promo is worth on this cart.
 *
 * Reward cups are removed from the pool first (cheapest N, mirroring
 * pickPromoCups and the flash/tier math) so a cup that a loyalty star already
 * makes free is never also discounted down to the tasting price — that would
 * be the same dollar twice.
 *
 * Of what is left, the most expensive matching cups are covered first: the
 * customer gets the bigger of two identical-looking choices, which is the
 * direction every other promo here rounds.
 */
export function tastingDiscountFor(args: {
  cups: TastingCup[];
  productName: string;
  tastingPriceCents: number;
  rewardCupCount?: number;
  maxCups?: number;
}): TastingDiscount {
  const target = normalizeName(args.productName);
  if (!target) return { amountCents: 0n, cupsCovered: 0 };

  const tasting = BigInt(Math.max(0, Math.floor(args.tastingPriceCents)));
  const maxCups = Math.max(0, args.maxCups ?? TASTING_CUPS_PER_ORDER);
  if (maxCups === 0) return { amountCents: 0n, cupsCovered: 0 };

  // Drop the cheapest N cups — those are the ones a loyalty reward covers.
  const rewardCount = Math.max(0, Math.floor(args.rewardCupCount ?? 0));
  const byPriceAsc = [...args.cups].sort((a, b) =>
    a.unitPriceCents < b.unitPriceCents
      ? -1
      : a.unitPriceCents > b.unitPriceCents
        ? 1
        : 0,
  );
  const payable = byPriceAsc.slice(Math.min(rewardCount, byPriceAsc.length));

  const matching = payable
    .filter((c) => normalizeName(c.itemName) === target)
    .map((c) => c.basePriceCents - tasting)
    .filter((saving) => saving > 0n)
    .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))
    .slice(0, maxCups);

  return {
    amountCents: matching.reduce((s, v) => s + v, 0n),
    cupsCovered: matching.length,
  };
}
