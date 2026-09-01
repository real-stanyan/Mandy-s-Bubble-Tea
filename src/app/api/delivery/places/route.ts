import { NextResponse } from "next/server";
import { extractPostcode } from "@/lib/delivery-zone";
import { interpretPlacesStatus } from "@/lib/places";
import { getAuthedUser } from "@/lib/auth";

// Server-side proxy for Google Places so the native app never embeds a key.
// Two shapes on one POST: { input, sessionToken } -> autocomplete predictions;
// { placeId } -> place details (address + lat/lng + postcode). AU-restricted.
export async function POST(request: Request) {
  // Require a signed-in customer (cookie session or app Bearer JWT). Without
  // this the proxy is an open relay against the merchant's paid Google key —
  // anyone could drain billing/quota or enumerate addresses for free.
  const user = await getAuthedUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
    let data: { status?: string; result?: { formatted_address?: string; geometry?: { location?: { lat: number; lng: number } }; address_components?: { long_name?: string; short_name?: string; types?: string[] }[] } };
    try {
      const r = await fetch(url);
      data = await r.json();
    } catch {
      return NextResponse.json({ error: "upstream" }, { status: 502 });
    }
    if (interpretPlacesStatus(data.status) === "down") {
      // A dead key (lapsed billing, revoked restriction) is not "no such
      // address" — reporting it as 404 sent the app back to a suggestion list
      // that could never populate. 503 says the service is out, not the query.
      console.error("[places] google status", data.status);
      return NextResponse.json({ error: "places_unavailable" }, { status: 503 });
    }
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
    let data: { status?: string; predictions?: { description: string; place_id: string }[] };
    try {
      const r = await fetch(url);
      data = await r.json();
    } catch {
      return NextResponse.json({ error: "upstream" }, { status: 502 });
    }
    if (interpretPlacesStatus(data.status) === "down") {
      // Same reason as above: an empty prediction list is indistinguishable
      // from "keep typing", and the customer will keep typing forever.
      console.error("[places] google status", data.status);
      return NextResponse.json({ error: "places_unavailable" }, { status: 503 });
    }
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
