// Pure builders + predicates for ActivityKit (Live Activity) APNs pushes.
// No IO and no server-only imports so vitest can exercise them directly;
// the sending side lives in live-activity.ts.
//
// Cross-platform contract (pinned with the iOS Widget Extension — do NOT
// change shapes or key names without coordinating with the app):
//
//   content-state: { status, driverName?, driverLat?, driverLng?, updatedAt }
//     pickup   status: preparing | ready | completed | canceled
//     delivery status: pending | accepted | picked_up | delivered | canceled
//
//   headers: apns-push-type: liveactivity
//            apns-topic:     com.mandysbubbletea.app.push-type.liveactivity
//            apns-priority:  10 (status transitions) / 5 (GPS heartbeats)
//
//   payload: { aps: { timestamp, event: "update"|"end", "content-state",
//                     "stale-date"?  (now+90, GPS/in-transit only),
//                     "dismissal-date"? (now+4h, event=end only) } }

export type LiveActivityStatus =
  | "preparing"
  | "ready"
  | "completed"
  | "pending"
  | "accepted"
  | "picked_up"
  | "delivered"
  | "canceled";

export type LiveActivityEvent = "update" | "end";

export type LiveActivityContentState = {
  status: LiveActivityStatus;
  driverName?: string;
  driverLat?: number;
  driverLng?: number;
  /** Unix seconds. */
  updatedAt: number;
};

/** App bundle topic — NOT the wallet passTypeId. Pinned by contract. */
export const LIVE_ACTIVITY_TOPIC =
  "com.mandysbubbletea.app.push-type.liveactivity";

/** GPS heartbeats go stale after 90s without a fresher push. */
export const GPS_STALE_SECONDS = 90;

/** Ended activities dismiss from the Lock Screen after 4h. */
export const END_DISMISSAL_SECONDS = 4 * 60 * 60;

/** Forward at most one GPS heartbeat per order per 25s. */
export const GPS_PUSH_MIN_INTERVAL_MS = 25_000;

export function buildLiveActivityPayload(args: {
  event: LiveActivityEvent;
  contentState: LiveActivityContentState;
  /** Unix seconds. */
  nowSeconds: number;
  /** GPS heartbeat / in-transit pushes only. */
  withStaleDate?: boolean;
}): { aps: Record<string, unknown> } {
  const aps: Record<string, unknown> = {
    timestamp: args.nowSeconds,
    event: args.event,
    "content-state": args.contentState,
  };
  if (args.withStaleDate) {
    aps["stale-date"] = args.nowSeconds + GPS_STALE_SECONDS;
  }
  if (args.event === "end") {
    aps["dismissal-date"] = args.nowSeconds + END_DISMISSAL_SECONDS;
  }
  return { aps };
}

export function liveActivityHeaders(priority: 5 | 10): Record<string, string> {
  return {
    "apns-topic": LIVE_ACTIVITY_TOPIC,
    "apns-push-type": "liveactivity",
    "apns-priority": String(priority),
  };
}

/**
 * GPS throttle predicate: true when no heartbeat has been forwarded yet, or
 * the last one is at least GPS_PUSH_MIN_INTERVAL_MS old. The authoritative
 * enforcement is the WHERE-guarded UPDATE in live-activity.ts (concurrency
 * safe); this mirrors that condition for callers/tests.
 */
export function shouldSendGpsPush(
  lastGpsPushAt: string | null,
  now: Date,
): boolean {
  if (!lastGpsPushAt) return true;
  const last = Date.parse(lastGpsPushAt);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= GPS_PUSH_MIN_INTERVAL_MS;
}

/** ISO timestamp of now minus the throttle window — rows with
 * last_gps_push_at older than this may send again. */
export function gpsThrottleCutoffIso(now: Date): string {
  return new Date(now.getTime() - GPS_PUSH_MIN_INTERVAL_MS).toISOString();
}

/**
 * Contract revision (2026-07-06, main-session ruling): the picked_up status
 * transition ALSO carries stale-date now+90s, not just GPS heartbeats. GPS
 * fixes should start flowing right after pickup — if none arrives within
 * 90s the Lock Screen card degrades to PAUSED instead of sitting forever
 * on a fake-LIVE map when the driver's GPS never started. Only picked_up:
 * accepted has no map (no PAUSED visual), and end events dismiss anyway.
 * The app-side isStale read is unaffected.
 */
export function statusPushWithStaleDate(kind: string): boolean {
  return kind === "la_picked_up";
}

/**
 * ActivityKit push tokens are hex strings (typically 160 chars). Bound the
 * length so a garbage body can't stuff the table.
 */
export function isValidActivityToken(token: unknown): token is string {
  return (
    typeof token === "string" && /^[0-9a-fA-F]{16,512}$/.test(token)
  );
}
