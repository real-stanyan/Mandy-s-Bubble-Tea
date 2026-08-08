import { describe, expect, it, vi } from "vitest";
import { createScrollLock } from "./scroll-lock";

/**
 * The rule this pins: page scroll comes back when the LAST overlay closes, in
 * whatever order they close.
 *
 * Why it exists (2026-08-08): the cart drawer, the menu item modal and the
 * order-tracking map overlay each saved and restored
 * document.body.style.overflow themselves. Two of them open at once and the
 * second one to close writes back a stale "hidden" — scroll dead until reload.
 * Reported on menu / checkout / order detail, iOS and desktop, "refreshing
 * fixes it". The non-LIFO case below is that bug.
 */

function harness() {
  const onLock = vi.fn();
  const onUnlock = vi.fn();
  return { lock: createScrollLock(onLock, onUnlock), onLock, onUnlock };
}

describe("createScrollLock", () => {
  it("locks on the first holder and unlocks on the last", () => {
    const { lock, onLock, onUnlock } = harness();
    const release = lock.acquire();
    expect(onLock).toHaveBeenCalledTimes(1);
    expect(onUnlock).not.toHaveBeenCalled();

    release();
    expect(onUnlock).toHaveBeenCalledTimes(1);
    expect(lock.holders).toBe(0);
  });

  it("does not re-lock for a nested holder", () => {
    const { lock, onLock } = harness();
    lock.acquire();
    lock.acquire();
    expect(onLock).toHaveBeenCalledTimes(1);
    expect(lock.holders).toBe(2);
  });

  it("stays locked while any holder is left", () => {
    const { lock, onUnlock } = harness();
    const a = lock.acquire();
    lock.acquire();

    a();
    expect(onUnlock).not.toHaveBeenCalled();
    expect(lock.holders).toBe(1);
  });

  it("releases out of order — the bug this exists for", () => {
    // A opens, B opens, A closes first, then B. Under the old
    // save-and-restore-my-own-copy scheme this left body overflow permanently
    // "hidden". Here the count is what decides, so order cannot strand it.
    const { lock, onLock, onUnlock } = harness();
    const a = lock.acquire();
    const b = lock.acquire();

    a();
    expect(onUnlock).not.toHaveBeenCalled();
    b();
    expect(onUnlock).toHaveBeenCalledTimes(1);
    expect(onLock).toHaveBeenCalledTimes(1);
    expect(lock.holders).toBe(0);
  });

  it("ignores a double release, so one holder cannot free another's lock", () => {
    // React can run a cleanup more than once (StrictMode in dev, an unmount
    // after an explicit release). Without the guard the count goes negative
    // and the next overlay to open never actually locks.
    const { lock, onUnlock } = harness();
    const a = lock.acquire();
    const b = lock.acquire();

    a();
    a();
    a();
    expect(onUnlock).not.toHaveBeenCalled();
    expect(lock.holders).toBe(1);

    b();
    expect(onUnlock).toHaveBeenCalledTimes(1);
    expect(lock.holders).toBe(0);
  });

  it("re-locks cleanly after everyone has left", () => {
    const { lock, onLock, onUnlock } = harness();
    lock.acquire()();
    const again = lock.acquire();
    expect(onLock).toHaveBeenCalledTimes(2);
    again();
    expect(onUnlock).toHaveBeenCalledTimes(2);
  });

  it("survives a deep stack closing back-to-front", () => {
    const { lock, onLock, onUnlock } = harness();
    const releases = [lock.acquire(), lock.acquire(), lock.acquire()];
    releases.reverse().forEach((r) => r());
    expect(onLock).toHaveBeenCalledTimes(1);
    expect(onUnlock).toHaveBeenCalledTimes(1);
    expect(lock.holders).toBe(0);
  });
});
