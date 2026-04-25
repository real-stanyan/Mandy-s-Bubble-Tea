import { NextResponse } from "next/server";
import { quoteDelivery } from "@/lib/uber-direct";
import { isWithinDeliveryRadius, STORE_COORDS } from "@/lib/places";
import { isDeliveryHoursOpen } from "@/lib/delivery-hours";
import { isDeliveryEligible } from "@/lib/delivery-fee";
import { getAuthedUser } from "@/lib/auth";

type QuoteBody = {
  address: string;
  lat: number;
  lng: number;
  unit?: string;
  driverNote?: string;
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
    typeof x.drinksSubtotalCents === "number"
  );
}

// Validates address against our 10 km radius + delivery hours + min order
// and proxies to Uber Direct for ETA + quote_id. The customer is required
// to be signed in (so we have a phone for Uber later). The quote_id is
// the source of truth — if Uber says no, we say no.
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

  if (!isDeliveryEligible(BigInt(Math.max(0, Math.floor(body.drinksSubtotalCents))))) {
    return NextResponse.json({ ok: false, reason: "min_order" });
  }
  if (!isDeliveryHoursOpen()) {
    return NextResponse.json({ ok: false, reason: "closed" });
  }
  if (!isWithinDeliveryRadius(STORE_COORDS, { lat: body.lat, lng: body.lng })) {
    return NextResponse.json({ ok: false, reason: "out_of_zone" });
  }

  const fullAddress = body.unit
    ? `${body.unit}, ${body.address}`
    : body.address;

  const result = await quoteDelivery({
    dropoffAddress: fullAddress,
    dropoffLat: body.lat,
    dropoffLng: body.lng,
    dropoffPhone: user.profile.phone_e164,
    dropoffName: [user.profile.first_name, user.profile.last_name].filter(Boolean).join(" ") || "Customer",
    orderValueCents: body.drinksSubtotalCents,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason });
  }
  return NextResponse.json({
    ok: true,
    quoteId: result.quoteId,
    etaMin: result.etaMin,
    expiresAt: result.expiresAt,
  });
}
