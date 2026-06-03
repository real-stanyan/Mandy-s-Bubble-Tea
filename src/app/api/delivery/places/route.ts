import { NextResponse } from "next/server";
import { extractPostcode } from "@/lib/delivery-zone";

// Server-side proxy for Google Places so the native app never embeds a key.
// Two shapes on one POST: { input, sessionToken } -> autocomplete predictions;
// { placeId } -> place details (address + lat/lng + postcode). AU-restricted.
export async function POST(request: Request) {
  // Read at request time so tests can inject the env var after module load.
  const KEY = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
  if (!KEY) {
    return NextResponse.json({ error: "places_unconfigured" }, { status: 503 });
  }
  let body: { input?: string; sessionToken?: string; placeId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body.placeId === "string" && body.placeId.length > 0) {
    const url =
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(body.placeId)}` +
      `&fields=formatted_address,geometry/location,address_components&key=${KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    const result = data.result;
    const loc = result?.geometry?.location;
    if (!result?.formatted_address || !loc) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({
      address: result.formatted_address,
      lat: loc.lat,
      lng: loc.lng,
      postcode: extractPostcode(result.address_components),
    });
  }

  if (typeof body.input === "string" && body.input.trim().length >= 3) {
    const url =
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(body.input)}` +
      `&components=country:au&key=${KEY}` +
      (body.sessionToken ? `&sessiontoken=${encodeURIComponent(body.sessionToken)}` : "");
    const r = await fetch(url);
    const data = await r.json();
    const predictions = Array.isArray(data.predictions)
      ? data.predictions.map((p: { description: string; place_id: string }) => ({
          description: p.description,
          placeId: p.place_id,
        }))
      : [];
    return NextResponse.json({ predictions });
  }

  return NextResponse.json({ error: "invalid_body" }, { status: 400 });
}
