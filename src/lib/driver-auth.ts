import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getDriverByCode, type DriverIdentity } from "./driver-tokens";

// Driver app auth — shared store password.
//
// A handful of trusted drivers all carry the same secret (STAFF_DELIVERY_TOKEN).
// The app's login screen collects it once and stores it; thereafter every
// request carries `Authorization: Bearer <token>`. This mirrors the existing
// Bearer-token house style (see src/app/api/admin/print-alert/route.ts) — no
// per-user accounts, no Supabase auth, just one shared secret. Comparison is
// constant-time so the endpoint can't be probed character-by-character.
// A second optional token (ADMIN_DELIVERY_TOKEN) resolves to a read-only
// "admin" role; mutation routes must 403 when role === "admin".

export type DriverRole = "driver" | "admin";

/**
 * Returns the role for the request's Bearer token:
 * STAFF_DELIVERY_TOKEN → "driver" (full access),
 * ADMIN_DELIVERY_TOKEN → "admin" (read-only monitor; mutation routes 403).
 * ADMIN_DELIVERY_TOKEN is optional — unset means no admin path exists.
 */
export function isAuthedDriver(request: Request): {
  ok: boolean;
  reason: "ok" | "unconfigured" | "unauthorized";
  role?: DriverRole;
} {
  const staffToken = process.env.STAFF_DELIVERY_TOKEN;
  if (!staffToken) return { ok: false, reason: "unconfigured" };
  const adminToken = process.env.ADMIN_DELIVERY_TOKEN;

  const auth = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!auth.startsWith(prefix)) return { ok: false, reason: "unauthorized" };
  const presented = auth.slice(prefix.length);

  // Staff is checked first, so if both env vars are (mis)configured to the
  // same value the token resolves to "driver" — keep the two secrets distinct.
  if (tokenMatches(presented, staffToken)) {
    return { ok: true, reason: "ok", role: "driver" };
  }
  if (adminToken && tokenMatches(presented, adminToken)) {
    return { ok: true, reason: "ok", role: "admin" };
  }
  return { ok: false, reason: "unauthorized" };
}

export type AuthDriverResult = {
  ok: boolean;
  reason: "ok" | "unconfigured" | "unauthorized";
  role?: DriverRole;
  /** The owning driver's id — null for the manager and the legacy shared code. */
  driverId?: string | null;
  /** Full profile for the resolved per-driver code (null otherwise). */
  driver?: DriverIdentity | null;
};

/**
 * Identity-aware auth. Resolution order:
 *   1. ADMIN_DELIVERY_TOKEN        → manager (read-only), driverId null
 *   2. a `drivers` row by code     → that driver (driverId + profile)
 *   3. STAFF_DELIVERY_TOKEN        → legacy shared driver, driverId null
 *                                    (transition fallback; remove after cutover)
 * Per-driver lookup is tried before the legacy staff token so that a code which
 * is BOTH (during cutover the shared token equals the sole driver's code)
 * resolves to the real driver identity, not the anonymous fallback.
 */
export async function authDriver(request: Request): Promise<AuthDriverResult> {
  const adminToken = process.env.ADMIN_DELIVERY_TOKEN;
  const staffToken = process.env.STAFF_DELIVERY_TOKEN;

  const auth = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!auth.startsWith(prefix)) {
    if (!adminToken && !staffToken) return { ok: false, reason: "unconfigured" };
    return { ok: false, reason: "unauthorized" };
  }
  const presented = auth.slice(prefix.length);

  // 1. manager
  if (adminToken && tokenMatches(presented, adminToken)) {
    return { ok: true, reason: "ok", role: "admin", driverId: null };
  }

  // 2. per-driver code
  if (presented) {
    let driver: DriverIdentity | null = null;
    try {
      driver = await getDriverByCode(presented);
    } catch (e) {
      // A DB hiccup shouldn't 500 the whole request when an env token might
      // still authorise it — log and fall through to the legacy check.
      console.error("[driver-auth] getDriverByCode failed", e);
    }
    if (driver) {
      return { ok: true, reason: "ok", role: "driver", driverId: driver.id, driver };
    }
  }

  // 3. legacy shared staff token
  if (staffToken && tokenMatches(presented, staffToken)) {
    return { ok: true, reason: "ok", role: "driver", driverId: null };
  }

  if (!adminToken && !staffToken) return { ok: false, reason: "unconfigured" };
  return { ok: false, reason: "unauthorized" };
}

// timingSafeEqual throws on length mismatch — guard with a length check first
// (token length leaking is not a meaningful weakness for internal staff codes).
function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
