// Pure derivation for the live-delivery freshness chip. Kept out of the React
// component (DeliveryMap's FreshnessBar) so it can be unit-tested in node env,
// same split as order-status-ui.ts.
//
// The driver app streams its GPS to /api/driver/location roughly every 10s
// while a delivery is in progress. So a healthy stream refreshes
// `location_updated_at` every ~10s. If we haven't seen a fix in STALE_AFTER_SEC
// the stream has dropped (app backgrounded / killed, lost GPS, network, token)
// — we must NOT keep presenting the last position as if the driver is live
// there. "stale" flips the chip to an honest paused/reconnecting state.

export type FreshnessState = "waiting" | "live" | "recent" | "stale";

// Driver posts ~10s; 90s tolerates ~9 missed beats before we call it dropped.
export const STALE_AFTER_SEC = 90;

export function freshness(
  hasDriver: boolean,
  locationUpdatedAt: string | null,
  now: number,
): { label: string; state: FreshnessState } {
  if (!hasDriver || !locationUpdatedAt) {
    return { label: "Waiting for driver location…", state: "waiting" };
  }
  const ageSec = Math.max(
    0,
    Math.round((now - new Date(locationUpdatedAt).getTime()) / 1000),
  );
  if (ageSec >= STALE_AFTER_SEC) {
    const mins = Math.round(ageSec / 60);
    return {
      label: `Location paused · last seen ${mins}m ago`,
      state: "stale",
    };
  }
  if (ageSec < 15) return { label: "Live · driver on the way", state: "live" };
  if (ageSec < 60) return { label: `Updated ${ageSec}s ago`, state: "recent" };
  return { label: `Updated ${Math.round(ageSec / 60)}m ago`, state: "recent" };
}
