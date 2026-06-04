import "server-only";
import { distanceKm, type LatLng } from "@/lib/places";

// Driving route + ETA for the customer-facing live delivery map.
//
// The status endpoint polls every 5s per watching customer, but Google
// Directions is a paid API — so the encoded polyline + duration are cached on
// the delivery_dispatch row and only re-fetched when the driver has moved
// >150m from the cached route origin or the cache is older than 2 minutes.
// All decision logic here is pure; the DB read/write lives in
// driver-tokens.ts next to the rest of the dispatch-row helpers.

export type RouteCache = {
  polyline: string | null;
  originLat: number | null;
  originLng: number | null;
  durationSecs: number | null;
  fetchedAt: string | null;
};

const REFETCH_DISTANCE_KM = 0.15; // driver drifted >150m from cached origin
const REFETCH_AGE_MS = 2 * 60 * 1000; // or cache older than 2 minutes

export function shouldRefetchRoute(
  cache: RouteCache | null,
  origin: LatLng,
  now: Date,
): boolean {
  if (
    !cache ||
    !cache.polyline ||
    cache.originLat == null ||
    cache.originLng == null ||
    !cache.fetchedAt
  ) {
    return true;
  }
  const ageMs = now.getTime() - new Date(cache.fetchedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > REFETCH_AGE_MS) return true;
  const movedKm = distanceKm(
    { lat: cache.originLat, lng: cache.originLng },
    origin,
  );
  return movedKm > REFETCH_DISTANCE_KM;
}

// Google encoded-polyline decoder (https://developers.google.com/maps/
// documentation/utilities/polylinealgorithm). Returns [lat, lng] pairs.
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const which of [0, 1] as const) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lng += delta;
    }
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

export function formatEtaMinutes(durationSecs: number | null): string | null {
  if (durationSecs == null || !Number.isFinite(durationSecs) || durationSecs <= 0) {
    return null;
  }
  return `~${Math.max(1, Math.ceil(durationSecs / 60))} min`;
}

/**
 * Fetch a driving route from Google Directions. Returns the encoded overview
 * polyline + duration, or null on any failure (quota, network, zero results)
 * — the live map simply renders without a route line in that case.
 */
export async function fetchDirectionsRoute(
  origin: LatLng,
  dest: LatLng,
  key: string,
): Promise<{ polyline: string; durationSecs: number | null } | null> {
  const url =
    "https://maps.googleapis.com/maps/api/directions/json" +
    `?origin=${origin.lat},${origin.lng}` +
    `&destination=${dest.lat},${dest.lng}` +
    `&mode=driving&key=${key}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[delivery-route] directions HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as {
      status?: string;
      routes?: {
        overview_polyline?: { points?: string };
        legs?: { duration?: { value?: number } }[];
      }[];
    };
    if (data.status !== "OK") {
      console.error(`[delivery-route] directions status ${data.status}`);
      return null;
    }
    const route = data.routes?.[0];
    const polyline = route?.overview_polyline?.points;
    if (!polyline) return null;
    const durationSecs = route?.legs?.reduce(
      (sum, leg) => sum + (leg.duration?.value ?? 0),
      0,
    );
    return {
      polyline,
      durationSecs: durationSecs && durationSecs > 0 ? durationSecs : null,
    };
  } catch (error) {
    console.error(
      "[delivery-route] directions fetch failed:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
