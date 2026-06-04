import "server-only";
import { timingSafeEqual } from "node:crypto";

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

// timingSafeEqual throws on length mismatch — guard with a length check first
// (token length leaking is not a meaningful weakness for internal staff codes).
function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
