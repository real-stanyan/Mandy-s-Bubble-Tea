// One scroll lock for every hand-rolled overlay on the site.
//
// Each overlay used to do this for itself:
//
//   const prev = document.body.style.overflow;
//   document.body.style.overflow = "hidden";
//   return () => { document.body.style.overflow = prev; };
//
// which assumes (a) it is the only lock on the page and (b) overlays always
// close in the reverse order they opened. Neither holds. The cart drawer lives
// in the layout, so it coexists with the menu item modal, the order-tracking
// map overlay, and every Radix dialog. Close them out of order and the last
// restore writes back a *stale* "hidden" — scroll is dead until a reload,
// which is exactly the reported symptom (menu / checkout / order detail,
// iOS and desktop alike, fixed by refreshing).
//
//   A opens  -> saves ""       -> body hidden
//   B opens  -> saves "hidden" -> body hidden
//   A closes -> restores ""    -> page scrolls behind B  (the tell)
//   B closes -> restores "hidden" -> stuck
//
// Counting fixes the ordering. The other half of the fix is *where* the lock
// is written: see toggleBodyScrollLock below.

/**
 * A reference-counted lock. The counting is the part with a rule in it, so it
 * is separated from the DOM work and unit-tested directly — the vitest suite
 * runs in a `node` environment with no document.
 *
 * `acquire()` returns that holder's release function. Release is idempotent:
 * calling it twice (React re-running a cleanup, a component unmounting after
 * it already released) must not drop someone else's lock.
 */
export function createScrollLock(
  onFirstLock: () => void,
  onLastRelease: () => void,
) {
  let holders = 0;

  return {
    acquire(): () => void {
      holders += 1;
      if (holders === 1) onFirstLock();

      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders -= 1;
        if (holders === 0) onLastRelease();
      };
    },
    /** Number of live holders. Exposed for tests and debugging only. */
    get holders() {
      return holders;
    },
  };
}

/** Marker attribute the stylesheet keys off. See globals.css. */
export const SCROLL_LOCK_ATTR = "data-scroll-locked";

/**
 * Write the lock as an attribute + stylesheet rule rather than an inline
 * style, deliberately.
 *
 * Radix dialogs (via react-remove-scroll) own body's *inline* overflow and do
 * their own save/restore of it. Two owners of one inline property clobber each
 * other's saved value — merging our three locks into one counter would fix us
 * fighting ourselves, but not us fighting Radix. An attribute lives in a
 * different layer: Radix can set and clear its inline style freely, we can set
 * and clear our attribute freely, and neither can strand the other.
 *
 * Not fixing the scrollbar-width layout shift here — the inline version had it
 * too, and widening the blast radius of a global scroll change is how you turn
 * one bug into two.
 */
function toggleBodyScrollLock(locked: boolean): void {
  if (typeof document === "undefined") return;
  if (locked) document.body.setAttribute(SCROLL_LOCK_ATTR, "");
  else document.body.removeAttribute(SCROLL_LOCK_ATTR);
}

const bodyLock = createScrollLock(
  () => toggleBodyScrollLock(true),
  () => toggleBodyScrollLock(false),
);

/**
 * Lock page scroll. Returns the release function for *this* holder — call it
 * when your overlay closes (an effect cleanup is the natural home). Scroll
 * comes back only once every holder has released.
 */
export function lockBodyScroll(): () => void {
  return bodyLock.acquire();
}

/** Live holder count. Tests and console debugging only. */
export function bodyScrollLockHolders(): number {
  return bodyLock.holders;
}
