import { STORE_PLACE_ID } from "@/lib/constants";

// Live Google Maps rating for the store, used on the home hero. Fetched
// server-side from the Google Places "Place Details" endpoint and cached for
// ~6h via Next's fetch revalidation so we don't hammer (and get billed by)
// the Places API on every render. Every failure path returns null — the hero
// falls back to a static review, so the page never breaks if the key is
// missing or Google is unreachable.

export type StoreRating = {
  rating: number; // e.g. 4.4
  total: number; // user_ratings_total, e.g. 422
  url: string | null; // Google Maps listing URL (reviews)
};

const REVALIDATE_SECONDS = 6 * 60 * 60; // 6 hours

export async function getStoreRating(): Promise<StoreRating | null> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
  if (!key) return null;

  const url =
    `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
      STORE_PLACE_ID,
    )}&fields=rating,user_ratings_total,url&key=${key}`;

  try {
    const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status?: string;
      result?: { rating?: number; user_ratings_total?: number; url?: string };
    };
    if (data.status !== "OK" || !data.result) {
      if (data.status && data.status !== "OK") {
        console.error("[store-rating] google status", data.status);
      }
      return null;
    }
    const { rating, user_ratings_total, url: mapsUrl } = data.result;
    if (typeof rating !== "number" || typeof user_ratings_total !== "number") {
      return null;
    }
    return { rating, total: user_ratings_total, url: mapsUrl ?? null };
  } catch {
    return null;
  }
}
