// Persists the per-checkout idempotency nonce so it survives a page reload or a
// re-entry into checkout (even in another tab of the same browser). The nonce is
// combined with a hash of the order body into the Square order idempotency key.
//
// Before this, the nonce lived in an in-memory useRef: a customer who reloaded
// after an unconfirmed payment got a FRESH nonce → a new idempotency key → a
// brand-new Square order + a SECOND card charge (real incident: OL809/OL810).
// Persisting it means the same cart re-submitted reuses the key → Square returns
// the original order → the payment route's COMPLETED guard blocks the 2nd charge.
//
// Cleared after a fully successful order so a later, deliberate order is new.

const KEY = "mbt_order_nonce_v1";
let memoryFallback: string | null = null;

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    // Safari private mode / storage disabled — fall back to memory.
    return null;
  }
}

export function getOrCreateOrderNonce(): string {
  const store = safeLocalStorage();
  if (store) {
    try {
      const existing = store.getItem(KEY);
      if (existing) return existing;
      const fresh = crypto.randomUUID();
      store.setItem(KEY, fresh);
      return fresh;
    } catch {
      // fall through to memory fallback on any storage error
    }
  }
  if (!memoryFallback) memoryFallback = crypto.randomUUID();
  return memoryFallback;
}

export function clearOrderNonce(): void {
  memoryFallback = null;
  const store = safeLocalStorage();
  if (store) {
    try {
      store.removeItem(KEY);
    } catch {
      // ignore
    }
  }
}
