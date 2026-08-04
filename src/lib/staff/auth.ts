import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

// Access control for the staff-only pages.
//
// These live on the public customer domain, so "nobody links to it" is not
// protection — the domain is known, and the same app takes payments. Shared
// passcodes are the deliberate trade: staff shouldn't need individual accounts
// to count stock, but a customer who guesses the URL should still get nothing.
//
// Two codes, two levels. Everyone in the shop knows the staff code and uses it
// for the stock check; the roster is behind the owner code, because it carries
// everybody's hours and days off.
//
// The cookie holds an HMAC, never the passcode itself, so a leaked cookie jar
// doesn't hand over a code the whole shop shares. Comparison is constant-time:
// passcodes this short are exactly where a timing oracle on string equality is
// worth closing.

export const STAFF_COOKIE = "staff_access";

export type StaffRole = "staff" | "owner";

/** Owner can reach everything staff can. */
const RANK: Record<StaffRole, number> = { staff: 1, owner: 2 };

/** 60 days: long enough that staff aren't re-typing it every shift. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 60;

function secret(): string {
  // Signing key, not a passcode. Reuses an existing server-only secret so a
  // deploy doesn't need yet another variable; if it's absent the tokens are
  // still consistent within the process, they just don't survive a rotation.
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "staff-dev-secret";
}

function passcodeFor(role: StaffRole): string | null {
  const value =
    role === "owner" ? process.env.OWNER_PASSCODE : process.env.STAFF_PASSCODE;
  return value && value.length > 0 ? value : null;
}

function tokenFor(role: StaffRole, passcode: string): string {
  return `${role}.${createHmac("sha256", secret()).update(`${role}:${passcode}`).digest("hex")}`;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function isConfigured(): boolean {
  return passcodeFor("staff") !== null || passcodeFor("owner") !== null;
}

/**
 * Match a typed passcode to a role. Both codes are always compared, so the
 * response time doesn't reveal which one was closer.
 */
export function checkPasscode(candidate: string): { role: StaffRole; token: string } | null {
  let matched: StaffRole | null = null;
  for (const role of ["staff", "owner"] as StaffRole[]) {
    const expected = passcodeFor(role);
    if (expected && safeEqual(candidate, expected)) matched = role;
  }
  if (!matched) return null;
  return { role: matched, token: tokenFor(matched, passcodeFor(matched)!) };
}

/** The role this request carries, or null. */
export async function currentRole(): Promise<StaffRole | null> {
  const jar = await cookies();
  const token = jar.get(STAFF_COOKIE)?.value;
  if (!token) return null;
  for (const role of ["owner", "staff"] as StaffRole[]) {
    const expected = passcodeFor(role);
    // No passcode configured means that level cannot be satisfied. Failing
    // closed matters more than convenience: the alternative is a deploy that
    // silently publishes the roster because an env var was missed.
    if (!expected) continue;
    if (safeEqual(token, tokenFor(role, expected))) return role;
  }
  return null;
}

export async function hasAtLeast(required: StaffRole): Promise<boolean> {
  const role = await currentRole();
  return role !== null && RANK[role] >= RANK[required];
}

export const STAFF_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  // Site-wide rather than scoped to /staff: the stock-check submit posts to
  // /api/staff/..., which a /staff-scoped cookie would never be sent to.
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};
