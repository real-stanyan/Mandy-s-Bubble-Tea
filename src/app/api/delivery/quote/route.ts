import { NextResponse } from "next/server";
import { distanceKm, STORE_COORDS } from "@/lib/places";
import { isDeliverablePostcode } from "@/lib/delivery-zone";
import { isDeliveryHoursOpen } from "@/lib/delivery-hours";
import { deliveryFeeCents, isDeliveryEligible, serviceFeeCents } from "@/lib/delivery-fee";
import { getAuthedUser } from "@/lib/auth";

type QuoteBody = {
  address: string;
  lat: number;
  lng: number;
  unit?: string;
  driverNote?: string;
  postcode: string;
  drinksSubtotalCents: number;
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
    typeof x.drinksSubtotalCents === "number"
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
  return NextResponse.json({
    ok: true,
    feeCents: Number(deliveryFeeCents(drinksSubtotalCents, distKm)),
    serviceFeeCents: Number(serviceFeeCents(drinksSubtotalCents)),
  });
}
