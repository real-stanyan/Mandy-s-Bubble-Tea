"use client";

// Browser-side Google Places SDK plumbing, split out of DeliveryAddressForm so
// the checkout page can ask "is Places actually answering?" without rendering
// the form. On 2026-09-01 the Maps project's billing lapsed: every prediction
// call came back REQUEST_DENIED / BillingNotEnabledMapError, the suggestion
// list stayed empty, and the address could never be confirmed — the form's only
// hint was "Pick your address from the suggestions to continue", which is
// exactly what the customer was trying to do. A dead dependency has to say so.

export const PLACES_KEY = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;

type PlacePrediction = { description: string; place_id: string };

declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          Autocomplete: new (
            input: HTMLInputElement,
            opts: { componentRestrictions?: { country: string }; fields?: string[] },
          ) => {
            addListener: (event: string, cb: () => void) => void;
            getPlace: () => {
              formatted_address?: string;
              geometry?: { location?: { lat: () => number; lng: () => number } };
              address_components?: {
                long_name?: string;
                short_name?: string;
                types?: string[];
              }[];
            };
          };
          AutocompleteService: new () => {
            getPlacePredictions: (
              request: {
                input: string;
                componentRestrictions?: { country: string };
              },
              callback: (
                predictions: PlacePrediction[] | null,
                status: string,
              ) => void,
            ) => void;
          };
        };
      };
    };
  }
}

/** Set by the script tag's own onerror — a blocked or 4xx script never
 *  defines `window.google`, and waiting the full timeout for that is wasted
 *  seconds on a checkout page. */
let scriptFailed = false;

// Loads the Google Places script once per page. Idempotent — multiple callers
// share the same `<script>` tag. No-op when the API key is missing.
export function ensureGoogleScript() {
  if (typeof window === "undefined") return;
  if (!PLACES_KEY) return;
  if (window.google?.maps?.places) return;
  if (document.getElementById("google-places-sdk")) return;
  const s = document.createElement("script");
  s.id = "google-places-sdk";
  s.async = true;
  s.src = `https://maps.googleapis.com/maps/api/js?key=${PLACES_KEY}&libraries=places&loading=async`;
  s.onerror = () => {
    scriptFailed = true;
  };
  document.head.appendChild(s);
}

/**
 * Resolves true once `google.maps.places` exists, false if the script fails or
 * the wait runs out. The old inline version retried every 200ms forever: with
 * the SDK blocked (ad blocker, offline, dead key) that timer outlived the page
 * and nothing ever told the customer.
 */
export function waitForPlaces(timeoutMs = 10_000): Promise<boolean> {
  ensureGoogleScript();
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !PLACES_KEY) {
      resolve(false);
      return;
    }
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (window.google?.maps?.places) {
        resolve(true);
        return;
      }
      if (scriptFailed || Date.now() > deadline) {
        resolve(false);
        return;
      }
      setTimeout(tick, 200);
    };
    tick();
  });
}

/**
 * One canned prediction call, purely to read the status code back. Google's
 * `Autocomplete` widget swallows failures (it just shows nothing), so this is
 * the only way to tell "no matches for what you typed" apart from "the key is
 * dead". Runs once per delivery checkout, not per keystroke.
 */
export function probePlacesStatus(): Promise<string | null> {
  return new Promise((resolve) => {
    const places = typeof window === "undefined" ? undefined : window.google?.maps?.places;
    if (!places?.AutocompleteService) {
      resolve(null);
      return;
    }
    let settled = false;
    const done = (status: string | null) => {
      if (settled) return;
      settled = true;
      resolve(status);
    };
    // A probe that never calls back must not leave the banner on "loading"
    // forever — that is the same dead end in a different costume.
    setTimeout(() => done(null), 8_000);
    try {
      new places.AutocompleteService().getPlacePredictions(
        { input: "1 George St", componentRestrictions: { country: "au" } },
        (_predictions, status) => done(status),
      );
    } catch {
      done(null);
    }
  });
}
