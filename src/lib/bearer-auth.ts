import "server-only";
import { timingSafeEqual } from "node:crypto";

// Shared constant-time Bearer-token check for internal shared-secret routes
// (cron, printer alert). Mirrors the house style in driver-auth.ts so secrets
// are never compared with a timing-variable `===`/`!==`, and the comparison
// can't be probed character-by-character.

export function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual throws on length mismatch; the length guard leaks only the
  // secret's length, which is not meaningful for internal codes.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** True iff the request carries `Authorization: Bearer <expected>` (constant-time). */
export function bearerTokenMatches(request: Request, expected: string): boolean {
  const auth = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!auth.startsWith(prefix)) return false;
  return constantTimeEquals(auth.slice(prefix.length), expected);
}
