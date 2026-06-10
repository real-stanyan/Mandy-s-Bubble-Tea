// Validates an OAuth `next` redirect target so a crafted value can't bounce a
// freshly-authenticated user off to an attacker-controlled origin.
//
// The naive `next.startsWith("/") && !next.startsWith("//")` check is NOT
// enough: `new URL()` normalizes backslashes to slashes for http(s), so
// `/\evil.com` and `/\t/evil.com` pass that check but resolve to
// https://evil.com/. We reject backslashes + control chars and then resolve
// against the origin and assert the result is same-origin.
export function safeNextPath(next: string | null | undefined, origin: string): string {
  const fallback = "/account";
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\\\x00-\x1f]/.test(next)) return fallback;
  try {
    const resolved = new URL(next, origin);
    if (resolved.origin !== origin) return fallback;
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return fallback;
  }
}
