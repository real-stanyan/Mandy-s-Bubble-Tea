"use client";

import { useEffect, useState } from "react";
import { interpretPlacesStatus, type PlacesHealth } from "@/lib/places";
import { PLACES_KEY, probePlacesStatus, waitForPlaces } from "@/lib/google-places";

/**
 * Whether address autocomplete can actually confirm an address right now.
 *
 * Delivery is unorderable without a Places-confirmed lat/lng, so when the SDK
 * is dead the customer needs to hear it from the page rather than by typing
 * their street name over and over. Runs one probe per delivery checkout —
 * `active` is false while the customer is on Pickup, so pickup-only sessions
 * cost nothing.
 */
export function usePlacesHealth(active: boolean): PlacesHealth {
  const [health, setHealth] = useState<PlacesHealth>("loading");

  useEffect(() => {
    if (!active) {
      setHealth("loading");
      return;
    }
    // No key configured is the same outcome for the customer as a dead key.
    if (!PLACES_KEY) {
      setHealth("down");
      return;
    }
    let cancelled = false;
    setHealth("loading");
    (async () => {
      const loaded = await waitForPlaces();
      if (cancelled) return;
      if (!loaded) {
        setHealth("down");
        return;
      }
      const status = await probePlacesStatus();
      if (cancelled) return;
      setHealth(interpretPlacesStatus(status));
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  return health;
}
