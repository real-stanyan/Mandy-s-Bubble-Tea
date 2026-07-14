import { NextResponse } from "next/server";
import { distanceKm, STORE_COORDS } from "@/lib/places";
import { isDeliverablePostcode } from "@/lib/delivery-zone";
import { isDeliveryHoursOpen } from "@/lib/delivery-hours";
import {
  deliveryFeeCents,
  freeDeliverySubtotalCents,
  isDeliveryEligible,
  serviceFeeCents,
} from "@/lib/delivery-fee";
import { getActivePublicHoliday } from "@/lib/holiday";
import { isDeliveryEnabled } from "@/lib/store-status-server";
import { getAuthedUser } from "@/lib/auth";

type QuoteBody = {
  address: string;
  lat: number;
  lng: number;
  unit?: string;
  driverNote?: string;
  postcode: string;
  drinksSubtotalCents: number;
  /**
   * Post-discount drinks amount (welcome/IG/tier/free-toppings/star-redeem
   * all subtracted) — fee, free-threshold and the 5% service fee are computed
   * on this (2026-07-10 rule). Optional: older clients (the RN App) don't
   * send it, so it falls back to the pre-discount subtotal.
   */
  paidDrinksSubtotalCents?: number;
};

function isValidBody(b: unknown): b is QuoteBody {
  if (!b || typeof b !== "object") return false;
  const x = b as Partial<QuoteBody>;
  return (
    typeof x.address === "string" &&
    x.address.length >= 3 &&
    typeof x.lat === "number" &&
    typeof x.lng === "number" &&
    typeof x.postcode === "string" &&
    typeof x.drinksSubtotalCents === "number" &&
    (x.paidDrinksSubtotalCents === undefined ||
      typeof x.paidDrinksSubtotalCents === "number")
  );
}

// Self-delivery quote: a pure internal validator. There is no third-party
// courier to call — Mandy's own staff deliver — so a "quote" just means
// "is this address eligible, in range, and are we open?" plus the fee math.
// The customer must be signed in (orders require a phone), matching /api/orders.
export async function POST(request: Request) {
  const user = await getAuthedUser(request);
  if (!user?.profile?.phone_e164) {
    return NextResponse.json(
      { ok: false, reason: "auth", detail: "Sign in with phone to get a delivery quote" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_json" }, { status: 400 });
  }
  if (!isValidBody(body)) {
    return NextResponse.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const drinksSubtotalCents = BigInt(Math.max(0, Math.floor(body.drinksSubtotalCents)));
  // Fee math runs on the post-discount paid amount; clamp into [0, pre] so a
  // client can't inflate it to fake the free-delivery threshold. Eligibility
  // ($12 minimum) below intentionally stays on the pre-discount subtotal,
  // matching /api/orders.
  const paidRaw =
    body.paidDrinksSubtotalCents !== undefined
      ? BigInt(Math.max(0, Math.floor(body.paidDrinksSubtotalCents)))
      : drinksSubtotalCents;
  const paidDrinksCents = paidRaw > drinksSubtotalCents ? drinksSubtotalCents : paidRaw;

  // Boss kill-switch: don't even price a delivery while the shop has it off.
  if (!(await isDeliveryEnabled())) {
    return NextResponse.json({ ok: false, reason: "unavailable" });
  }
  if (!isDeliveryEligible(drinksSubtotalCents)) {
    return NextResponse.json({ ok: false, reason: "min_order" });
  }
  if (!isDeliveryHoursOpen()) {
    return NextResponse.json({ ok: false, reason: "closed" });
  }
  if (!isDeliverablePostcode(body.postcode)) {
    return NextResponse.json({ ok: false, reason: "out_of_zone" });
  }

  const dest = { lat: body.lat, lng: body.lng };
  const distKm = distanceKm(STORE_COORDS, dest);
  // Mirror /api/orders: the free-delivery threshold is judged on the
  // surcharge-inclusive paid subtotal. This preview assumes a normal (non-
  // redeem) order — it can't see whether platform/card are skipped — so a
  // redeem order near the threshold defers to the authoritative /api/orders
  // charge, consistent with the 2026-07-10 "server charge is authoritative" rule.
  const freeThresholdCents = freeDeliverySubtotalCents(paidDrinksCents, {
    orderSurcharges: true,
    publicHoliday: !!getActivePublicHoliday(new Date()),
  });
  return NextResponse.json({
    ok: true,
    feeCents: Number(deliveryFeeCents(freeThresholdCents, distKm)),
    serviceFeeCents: Number(serviceFeeCents(paidDrinksCents)),
  });
}
