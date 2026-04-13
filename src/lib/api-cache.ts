/**
 * Thin sessionStorage cache for expensive client-side API calls.
 * Prevents duplicate fetches within the same session (e.g. customer
 * lookup and loyalty account queries that fire from both the cart
 * drawer and the account/checkout pages).
 */

const DEFAULT_TTL_MS = 60_000; // 60 seconds

type CacheEntry = {
  data: unknown;
  expiresAt: number;
};

function cacheKey(url: string, body: string): string {
  return `mbt:api:${url}:${body}`;
}

/**
 * POST fetch with sessionStorage caching. Returns cached JSON if
 * still within TTL, otherwise makes the request and caches the result.
 */
export async function cachedPost<T = unknown>(
  url: string,
  body: Record<string, unknown>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<{ ok: boolean; status: number; data: T }> {
  const bodyStr = JSON.stringify(body);
  const key = cacheKey(url, bodyStr);

  // Check cache.
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const entry: CacheEntry = JSON.parse(raw);
      if (entry.expiresAt > Date.now()) {
        return { ok: true, status: 200, data: entry.data as T };
      }
      sessionStorage.removeItem(key);
    }
  } catch {
    // sessionStorage unavailable — proceed without cache.
  }

  // Fetch.
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: bodyStr,
  });
  const data = await res.json();

  // Cache successful responses only.
  if (res.ok) {
    try {
      const entry: CacheEntry = { data, expiresAt: Date.now() + ttlMs };
      sessionStorage.setItem(key, JSON.stringify(entry));
    } catch {
      // Quota exceeded or unavailable — ignore.
    }
  }

  return { ok: res.ok, status: res.status, data };
}

/** Invalidate all cached API responses (e.g. on sign-out). */
export function clearApiCache(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith("mbt:api:")) keysToRemove.push(k);
    }
    keysToRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // Ignore.
  }
}
