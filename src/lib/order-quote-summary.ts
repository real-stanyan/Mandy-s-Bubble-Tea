import type { Order } from "square";
import {
  CARD_SURCHARGE_BPS,
  PH_SURCHARGE_BPS,
  PLATFORM_FEE_BPS,
} from "@/lib/constants";
import type { OrderPricing } from "@/lib/order-quote";

// Turns a priced order into the JSON the checkout summaries render.
//
// Every amount is a decimal STRING of cents, not a number: cents are BigInt
// everywhere server-side and JSON has no BigInt. Clients parse them back with
// BigInt(...) — never Number(), which silently rounds past 2^53.
//
// Kept separate from the route so the shape and the fallback arithmetic are
// unit-testable without a Square client.

export type QuoteAmount = {
  uid: string;
  name: string;
  amountCents: string;
  /**
   * Display-only aside for this row, e.g. "3 left this month". Absent on most
   * rows. Never sent to Square — see OrderPricing.discountNotes for why.
   */
  note?: string;
};

export type OrderQuoteSummary = {
  /** Pre-discount line-item total. */
  subtotalCents: string;
  discounts: QuoteAmount[];
  serviceCharges: QuoteAmount[];
  discountTotalCents: string;
  serviceChargeTotalCents: string;
  /** Estimated money a loyalty reward will cover (cheapest N cups). */
  rewardCupsSumCents: string;
  /** Order total as Square will compute it, BEFORE the loyalty reward. */
  totalCents: string;
  /** What the card is actually charged: total minus the reward, floored at 0. */
  netTotalCents: string;
  /**
   * True when Square's `orders.calculate` was unavailable and the percentage
   * service charges were computed here instead. The numbers may then differ
   * from the charge by up to a cent per percentage charge (Square rounds
   * half-up, this floors). Clients should still show them — an off-by-a-cent
   * summary beats a blank one — but must not treat them as the charge.
   */
  estimated: boolean;
};

/** Basis points per percentage service charge we attach, keyed by its uid. */
const PERCENTAGE_CHARGE_BPS: Record<string, bigint> = {
  "platform-fee": PLATFORM_FEE_BPS,
  "card-surcharge": CARD_SURCHARGE_BPS,
  "public-holiday-surcharge": PH_SURCHARGE_BPS,
};

function moneyOf(m: { amount?: bigint | null } | null | undefined): bigint {
  return m?.amount ?? 0n;
}

export function summarizeQuote(
  pricing: OrderPricing,
  calculated: Order | null,
): OrderQuoteSummary {
  const estimated = calculated == null;

  // Pre-discount subtotal, from computeOrderPricing's catalog money.
  //
  // NOT from Square's response: `orders.calculate` returns line-item
  // grossSalesMoney and totalMoney ALREADY net of an ORDER-scope discount
  // (verified 2026-07-28: 8 cups at A$6.20 with a A$11.20 discount come back as
  // grossSalesMoney A$38.40, not A$49.60). Summing those and then printing the
  // discount as its own row would subtract it twice.
  const subtotalCents = pricing.drinksSubtotalCents;

  // Discounts are FIXED_AMOUNT and server-computed, so our own numbers are
  // already exact — Square echoes them back unchanged. Names come from here
  // too, because they carry the drink counts the summary prints.
  const discounts: QuoteAmount[] = pricing.discounts.map((d) => {
    const note = pricing.discountNotes?.[d.uid];
    return {
      uid: d.uid,
      name: d.name,
      amountCents: d.amountMoney.amount.toString(),
      ...(note ? { note } : {}),
    };
  });
  const discountTotal = pricing.discounts.reduce(
    (s, d) => s + d.amountMoney.amount,
    0n,
  );

  // Service charges: the percentage ones (platform / card / public holiday)
  // only have an amount once someone multiplies them out. Square did that if it
  // answered; otherwise fall back to the same basis points.
  //
  // The base is the POST-discount amount. SUBTOTAL_PHASE sounds like it should
  // mean the pre-discount subtotal and the old client-side mirror assumed so —
  // it doesn't. Measured against Square: 8 cups at A$6.20 charge A$0.25 + A$0.94
  // undiscounted, and A$0.19 + A$0.73 once a A$11.20 discount lands, i.e. 0.5%
  // and 1.9% of A$38.40. The old mirror therefore over-stated the fees on every
  // discounted order (part of what web #73 was seeing).
  const squareChargeByUid = new Map<string, bigint>();
  for (const sc of calculated?.serviceCharges ?? []) {
    if (!sc.uid) continue;
    squareChargeByUid.set(
      sc.uid,
      moneyOf(sc.totalMoney) || moneyOf(sc.amountMoney),
    );
  }

  let percentageBase = subtotalCents - discountTotal;
  if (percentageBase < 0n) percentageBase = 0n;

  const serviceCharges: QuoteAmount[] = pricing.serviceCharges.map((sc) => {
    const uid = sc.uid ?? "";
    const fromSquare = squareChargeByUid.get(uid);
    let amount: bigint;
    if (fromSquare != null) {
      amount = fromSquare;
    } else if (PERCENTAGE_CHARGE_BPS[uid] != null) {
      amount = (percentageBase * PERCENTAGE_CHARGE_BPS[uid]) / 10000n;
    } else {
      // Fixed-amount charges (delivery fee, 5% service fee) already carry
      // their own money — computeOrderPricing sized them.
      amount = moneyOf(sc.amountMoney);
    }
    return { uid, name: sc.name ?? "", amountCents: amount.toString() };
  });
  const serviceChargeTotal = serviceCharges.reduce(
    (s, sc) => s + BigInt(sc.amountCents),
    0n,
  );

  let total = calculated
    ? moneyOf(calculated.totalMoney)
    : subtotalCents - discountTotal + serviceChargeTotal;
  if (total < 0n) total = 0n;

  // The loyalty reward is NOT part of the Square order yet — it's attached by
  // CreateLoyaltyReward after the order exists. So the quote shows the reward
  // as its own line and nets it off here, using the server's cheapest-N
  // estimate. One estimate, shared by both checkout pages.
  let netTotal = total - pricing.rewardCupsSumCents;
  if (netTotal < 0n) netTotal = 0n;

  return {
    subtotalCents: subtotalCents.toString(),
    discounts,
    serviceCharges,
    discountTotalCents: discountTotal.toString(),
    serviceChargeTotalCents: serviceChargeTotal.toString(),
    rewardCupsSumCents: pricing.rewardCupsSumCents.toString(),
    totalCents: total.toString(),
    netTotalCents: netTotal.toString(),
    estimated,
  };
}
