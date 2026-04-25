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
