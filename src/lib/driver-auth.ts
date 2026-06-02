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

/**
 * Returns true if the request carries the correct driver Bearer token.
 * Returns false (never throws) when the header is missing/malformed or the
 * server secret isn't configured — callers respond 401/500 accordingly.
 */
export function isAuthedDriver(request: Request): {
  ok: boolean;
  reason: "ok" | "unconfigured" | "unauthorized";
} {
  const expected = process.env.STAFF_DELIVERY_TOKEN;
  if (!expected) return { ok: false, reason: "unconfigured" };

  const auth = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!auth.startsWith(prefix)) return { ok: false, reason: "unauthorized" };
  const presented = auth.slice(prefix.length);

  // timingSafeEqual throws on length mismatch — guard with a length check
  // first (length is not secret here; the shared password's length leaking
  // is not a meaningful weakness for an internal staff token).
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false, reason: "unauthorized" };
  const ok = timingSafeEqual(a, b);
  return { ok, reason: ok ? "ok" : "unauthorized" };
}
