import { DELIVERY, STORE_LAT, STORE_LNG } from "./constants";

export type LatLng = { lat: number; lng: number };

export const STORE_COORDS: LatLng = { lat: STORE_LAT, lng: STORE_LNG };

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Great-circle distance in km via Haversine. Accurate to ~0.5% for
// Earth-surface distances under 100 km, which is more than enough
// precision for a 10 km delivery radius check.
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function isWithinDeliveryRadius(store: LatLng, dest: LatLng): boolean {
  return distanceKm(store, dest) <= DELIVERY.maxKm;
}

// A delivery coordinate is "confirmed" only when it is finite and non-zero.
// The store sits at lat -28 / lng 153, so 0/0 is never a real Mandy's
// coordinate — the form uses it as the "no address selected yet" sentinel.
export function coordsAreValid(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
}

/** Is the browser's Places SDK usable right now? */
export type PlacesHealth = "loading" | "ready" | "down";

/**
 * Turn a Places prediction status into a verdict about the *service*, not the
 * query. `ZERO_RESULTS` means Google answered and had nothing to say — the
 * service is fine. Everything else (REQUEST_DENIED from lapsed billing or a
 * restricted key, OVER_QUERY_LIMIT, UNKNOWN_ERROR, or no answer at all) means
 * no address can be confirmed, so delivery cannot be ordered and the customer
 * has to be told instead of left retyping. See src/lib/google-places.ts.
 */
export function interpretPlacesStatus(
  status: string | null | undefined,
): "ready" | "down" {
  return status === "OK" || status === "ZERO_RESULTS" ? "ready" : "down";
}
