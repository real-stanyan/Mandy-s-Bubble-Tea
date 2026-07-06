import "server-only";
import http2 from "node:http2";
import { SignJWT, importPKCS8 } from "jose";
import { getSupabaseAdmin } from "./supabase-server";
import { claimOrderPushSlot, type LiveActivityPushKind } from "./push-tokens";
import { getDispatchTracking } from "./driver-tokens";
import {
  buildLiveActivityPayload,
  gpsThrottleCutoffIso,
  liveActivityHeaders,
  type LiveActivityContentState,
  type LiveActivityEvent,
  type LiveActivityStatus,
} from "./live-activity-payload";

// APNs sender for iOS Live Activities (ActivityKit). Forked from
// src/lib/wallet/apns.ts (same .p8 ES256 JWT + http2 skeleton) but pushes
// to the APP bundle topic with apns-push-type: liveactivity — never the
// wallet passTypeId. The .p8 auth key is team-level, so the wallet env vars
// (APNS_AUTH_KEY_P8 / APNS_KEY_ID / APPLE_TEAM_ID / APNS_HOST) are reused
// directly; no new env needed. Read here rather than via walletEnv() so a
// missing wallet-only var (QSTASH_*, pass certs) can't break order pushes.
//
// All public senders are fire-and-forget-safe: they catch and log every
// failure with a [live-activity] prefix and never throw, so a push problem
// can never affect the host route's response.

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[live-activity] missing env var: ${name}`);
  return v;
}

/** Decode literal \n from env vars back to real newlines. */
function decodePem(s: string): string {
  return s.replace(/\\n/g, "\n");
}

let cachedJwt: { token: string; expiresAt: number } | null = null;

async function buildApnsJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwt.expiresAt > now + 60) return cachedJwt.token;

  const key = await importPKCS8(decodePem(requireEnv("APNS_AUTH_KEY_P8")), "ES256");
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: requireEnv("APNS_KEY_ID") })
    .setIssuer(requireEnv("APPLE_TEAM_ID"))
    .setIssuedAt(now)
    .sign(key);

  cachedJwt = { token, expiresAt: now + 3300 }; // 55 min
  return token;
}

type ApnsSendResult = { status: number; reason?: string };

async function sendApnsLiveActivity(args: {
  activityToken: string;
  payload: { aps: Record<string, unknown> };
  priority: 5 | 10;
}): Promise<ApnsSendResult> {
  const jwt = await buildApnsJwt();
  const host = process.env.APNS_HOST ?? "api.push.apple.com";
  const client = http2.connect(`https://${host}`);
  try {
    return await new Promise<ApnsSendResult>((resolve) => {
      const req = client.request({
        ":method": "POST",
        ":path": `/3/device/${args.activityToken}`,
        authorization: `bearer ${jwt}`,
        "content-type": "application/json",
        ...liveActivityHeaders(args.priority),
      });
      let status = 0;
      let chunks = "";
      req.on("response", (h) => {
        status = Number(h[":status"]);
      });
      req.on("data", (d) => {
        chunks += d.toString();
      });
      req.on("end", () => {
        let reason: string | undefined;
        try {
          reason = chunks ? (JSON.parse(chunks) as { reason?: string }).reason : undefined;
        } catch {
          // non-JSON body — leave reason undefined
        }
        resolve({ status, reason });
      });
      req.on("error", (err) => resolve({ status: 0, reason: err.message }));
      req.end(JSON.stringify(args.payload));
    });
  } finally {
    client.close();
  }
}

// ── Token store (order_live_activities, service-role only) ──────────────────

export async function upsertLiveActivityToken(
  orderId: string,
  activityToken: string,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("order_live_activities").upsert(
    {
      order_id: orderId,
      activity_token: activityToken,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "order_id" },
  );
  if (error) throw new Error(`upsertLiveActivityToken: ${error.message}`);
}

/** Null when the customer never started a Live Activity (or runs an old build). */
export async function getLiveActivityToken(orderId: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("order_live_activities")
    .select("activity_token")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) throw new Error(`getLiveActivityToken: ${error.message}`);
  return (data?.activity_token as string | undefined) ?? null;
}

async function deleteLiveActivityRow(orderId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("order_live_activities")
    .delete()
    .eq("order_id", orderId);
  if (error) throw new Error(`deleteLiveActivityRow: ${error.message}`);
}

/**
 * Atomically claim the right to forward a GPS heartbeat: bump
 * last_gps_push_at ONLY when the previous bump is ≥25s old (or never
 * happened), returning the activity token on success. The WHERE guard is
 * what prevents two concurrent driver posts from double-sending — the
 * loser's UPDATE matches zero rows. Returns null when throttled or when
 * the order has no Live Activity.
 */
async function claimGpsPushSlot(orderId: string, now: Date): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("order_live_activities")
    .update({ last_gps_push_at: now.toISOString() })
    .eq("order_id", orderId)
    .or(`last_gps_push_at.is.null,last_gps_push_at.lt.${gpsThrottleCutoffIso(now)}`)
    .select("activity_token");
  if (error) throw new Error(`claimGpsPushSlot: ${error.message}`);
  return (data?.[0]?.activity_token as string | undefined) ?? null;
}

// ── Send outcome handling ────────────────────────────────────────────────────

async function handleSendResult(
  orderId: string,
  label: string,
  res: ApnsSendResult,
): Promise<void> {
  if (res.status === 200) return;
  // Dead token: the activity ended on-device or the token rotated. Drop the
  // row so we stop pushing at it.
  if (res.status === 410 || (res.status === 400 && res.reason === "BadDeviceToken")) {
    console.warn(
      `[live-activity] dead token for order=${orderId} (${res.status} ${res.reason ?? ""}) — deleting row`,
    );
    await deleteLiveActivityRow(orderId).catch((err) =>
      console.error(
        `[live-activity] token cleanup failed order=${orderId}:`,
        err instanceof Error ? err.message : String(err),
      ),
    );
    return;
  }
  console.error(
    `[live-activity] APNs rejected ${label} push order=${orderId} status=${res.status} reason=${res.reason ?? "unknown"}`,
  );
}

// ── Public senders (never throw) ─────────────────────────────────────────────

/**
 * Status-transition push (apns-priority 10). Idempotent via the shared
 * order_push_notifications ledger — Square webhook redeliveries and driver
 * re-taps claim the same (orderId, kind) slot, so only the first sends.
 * Silently no-ops when the order has no Live Activity token.
 */
export async function sendLiveActivityStatusPush(args: {
  orderId: string;
  kind: LiveActivityPushKind;
  status: LiveActivityStatus;
  event: LiveActivityEvent;
  driverName?: string | null;
}): Promise<void> {
  try {
    const token = await getLiveActivityToken(args.orderId);
    if (!token) return; // no LA on this order — silent skip
    const claimed = await claimOrderPushSlot(args.orderId, args.kind);
    if (!claimed) return; // already sent (webhook redelivery / re-tap)

    const nowSeconds = Math.floor(Date.now() / 1000);
    const contentState: LiveActivityContentState = {
      status: args.status,
      updatedAt: nowSeconds,
    };
    if (args.driverName) contentState.driverName = args.driverName;

    const res = await sendApnsLiveActivity({
      activityToken: token,
      payload: buildLiveActivityPayload({
        event: args.event,
        contentState,
        nowSeconds,
      }),
      priority: 10,
    });
    await handleSendResult(args.orderId, args.kind, res);
  } catch (err) {
    console.error(
      `[live-activity] status push failed order=${args.orderId} kind=${args.kind}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * GPS heartbeat push (apns-priority 5, stale-date now+90s). Only forwards
 * while the dispatch is in-flight (accepted | picked_up) and at most once
 * per 25s per order — throttle enforced by claimGpsPushSlot's WHERE-guarded
 * UPDATE so concurrent driver posts can't double-send.
 */
export async function sendLiveActivityGpsPush(args: {
  orderId: string;
  lat: number;
  lng: number;
  driverName?: string | null;
}): Promise<void> {
  try {
    const dispatch = await getDispatchTracking(args.orderId);
    if (
      !dispatch ||
      (dispatch.status !== "accepted" && dispatch.status !== "picked_up")
    ) {
      return; // not in-flight — no heartbeat
    }

    const now = new Date();
    const token = await claimGpsPushSlot(args.orderId, now);
    if (!token) return; // no LA token, or throttled (<25s since last forward)

    const nowSeconds = Math.floor(now.getTime() / 1000);
    const contentState: LiveActivityContentState = {
      status: dispatch.status,
      driverLat: args.lat,
      driverLng: args.lng,
      updatedAt: nowSeconds,
    };
    if (args.driverName) contentState.driverName = args.driverName;

    const res = await sendApnsLiveActivity({
      activityToken: token,
      payload: buildLiveActivityPayload({
        event: "update",
        contentState,
        nowSeconds,
        withStaleDate: true,
      }),
      priority: 5,
    });
    await handleSendResult(args.orderId, "gps", res);
  } catch (err) {
    console.error(
      `[live-activity] gps push failed order=${args.orderId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
