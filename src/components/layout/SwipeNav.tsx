"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TABS, swipeableTabIndex } from "@/components/layout/tabs";
import {
  ARRIVE_TIMEOUT_MS,
  CANCEL_MS,
  IN_MS,
  OUT_MS,
  TAB_DRAG_EVENT,
  blendVelocity,
  dragOffset,
  ghostX,
  lockAxis,
  neighbourIndex,
  shouldCommit,
  windowIndex,
  type Axis,
  type TabDragDetail,
} from "@/lib/motion/swipe-nav";

// Swiping between the tab pages on the phone (Rick, 2026-09-11): a
// sideways drag anywhere on Home pulls the page out under the thumb and a
// pane of frosted glass in from the right wearing the Menu mark; let go past
// a third of the screen (or flick) and the page turns — the glass covers
// the screen, the Menu route streams in behind it, and the glass dissolves
// off it. Drag back, or not far enough, and everything settles where it
// was. The pane rides SEAM_OVERLAP over the page at the join with a
// feathered edge, so the seam between the two is a blur that fades rather
// than a line — the frosted edge the App draws between its pages.
//
// Only on touch, only under the desktop breakpoint (the pill is the mobile
// chrome), only from a tab root: an item sheet over the menu, an Account
// sub-page, checkout, a dialog with the page scroll-locked, or a touch that
// starts in a carousel, a field or anything fixed is left alone. Vertical
// reading is never taken — the axis is decided in the first dozen pixels
// and a diagonal counts as reading (lib/motion/swipe-nav).
//
// Everything that moves is a transform on two elements, driven straight
// from touch events and finished with the Web Animations API; React only
// hears which tab the glass should wear, and the route change itself.

const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const EASE_DISSOLVE = "cubic-bezier(0.4, 0, 0.6, 1)";
const MOBILE = "(max-width: 1023.98px)";
const NO_SWIPE =
  '[role="dialog"], [aria-modal="true"], .fixed, input, textarea, select, [contenteditable="true"], [data-no-swipe]';

function emitTabDrag(index: number | null, live: boolean) {
  window.dispatchEvent(
    new CustomEvent<TabDragDetail>(TAB_DRAG_EVENT, { detail: { index, live } }),
  );
}

/** A carousel keeps its own sideways drags. */
function insideHorizontalScroller(target: Element, stop: HTMLElement): boolean {
  let el: Element | null = target;
  while (el && el !== stop) {
    if (el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
    el = el.parentElement;
  }
  return false;
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Pending = { href: string; timer: number };

export function SwipeNav({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const pageRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const pendingRef = useRef<Pending | null>(null);
  const arriveRef = useRef<() => void>(() => {});
  const [ghostTab, setGhostTab] = useState<number | null>(null);

  // The route the glass was waiting for has rendered underneath it.
  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending || pathname !== pending.href) return;
    window.clearTimeout(pending.timer);
    pendingRef.current = null;
    arriveRef.current();
  }, [pathname]);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const mql = window.matchMedia(MOBILE);

    let active = false;
    let axis: Axis = "none";
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastT = 0;
    let vx = 0;
    let fromIndex = -1;
    let toIndex: number | null = null;
    let dir: 1 | -1 = 1;
    let width = 0;
    let offset = 0;
    let animations: Animation[] = [];

    const ghost = () => ghostRef.current;
    const setPageX = (x: number) => {
      page.style.transform = x === 0 ? "" : `translate3d(${x}px,0,0)`;
    };
    const setGhostX = (x: number) => {
      const g = ghost();
      if (g) g.style.transform = `translate3d(${x}px,0,0)`;
    };
    const clearAnimations = () => {
      for (const a of animations) a.cancel();
      animations = [];
    };
    const track = (a: Animation) => {
      animations.push(a);
      return a;
    };
    /** Run `done` when the animation finishes — or a beat after it should
     *  have, if the browser stopped advancing animations (a tab put in the
     *  background mid-gesture never fires onfinish) — but only once. */
    const whenDone = (a: Animation, ms: number, done: () => void) => {
      let ran = false;
      const once = () => {
        if (ran) return;
        ran = true;
        done();
      };
      a.onfinish = once;
      window.setTimeout(once, ms + 120);
    };

    /** Everything back to rest. */
    const finish = () => {
      page.style.transform = "";
      page.style.willChange = "";
      document.documentElement.style.overflowX = "";
      clearAnimations();
      const g = ghost();
      if (g) {
        g.dataset.state = "idle";
        g.style.transform = "";
        g.style.opacity = "";
      }
      setGhostTab(null);
      emitTabDrag(null, false);
    };

    const begin = (to: number | null, d: 1 | -1) => {
      toIndex = to;
      dir = d;
      width = page.clientWidth || window.innerWidth;
      offset = 0;
      page.style.willChange = "transform";
      // The page moving sideways must not give the document a second axis.
      document.documentElement.style.overflowX = "hidden";
      if (to == null) return;
      setGhostTab(to);
      const g = ghost();
      if (g) {
        g.dataset.state = "dragging";
        g.dataset.dir = d === 1 ? "right" : "left";
        g.style.opacity = "1";
        setGhostX(ghostX(0, d, width));
      }
      // Intent, not speculation: one fetch, for the page the thumb is already
      // pulling in — unlike the viewport prefetch the pill opts out of.
      router.prefetch(TABS[to].href);
    };

    const render = (dx: number) => {
      // Pulling back past where the drag began meets the same rubber as an
      // end: the glass was raised for the other side.
      const wrongWay = (dir === 1 && dx > 0) || (dir === -1 && dx < 0);
      offset = dragOffset(dx, toIndex != null && !wrongWay);
      setPageX(offset);
      if (toIndex == null) return;
      setGhostX(ghostX(offset, dir, width));
      emitTabDrag(windowIndex(fromIndex, offset, width, TABS.length), true);
    };

    const cancelDrag = () => {
      const ms = reducedMotion() ? 0 : CANCEL_MS;
      const g = ghost();
      if (toIndex != null && g) {
        track(
          g.animate(
            [
              { transform: `translate3d(${ghostX(offset, dir, width)}px,0,0)` },
              { transform: `translate3d(${ghostX(0, dir, width)}px,0,0)` },
            ],
            { duration: ms, easing: EASE_OUT, fill: "forwards" },
          ),
        );
      }
      const back = track(
        page.animate(
          [{ transform: `translate3d(${offset}px,0,0)` }, { transform: "none" }],
          { duration: ms, easing: EASE_OUT, fill: "forwards" },
        ),
      );
      emitTabDrag(fromIndex, false);
      whenDone(back, ms, finish);
    };

    const commit = () => {
      if (toIndex == null) return;
      const target = TABS[toIndex];
      const ms = reducedMotion() ? 0 : OUT_MS;
      const end = -dir * width;
      track(
        page.animate(
          [
            { transform: `translate3d(${offset}px,0,0)` },
            { transform: `translate3d(${end}px,0,0)` },
          ],
          { duration: ms, easing: EASE_OUT, fill: "forwards" },
        ),
      );
      const g = ghost();
      if (g) {
        track(
          g.animate(
            [
              { transform: `translate3d(${ghostX(offset, dir, width)}px,0,0)` },
              { transform: `translate3d(${ghostX(end, dir, width)}px,0,0)` },
            ],
            { duration: ms, easing: EASE_OUT, fill: "forwards" },
          ),
        );
      }
      emitTabDrag(toIndex, false);
      const timer = window.setTimeout(() => {
        pendingRef.current = null;
        finish();
      }, ARRIVE_TIMEOUT_MS);
      pendingRef.current = { href: target.href, timer };
      router.push(target.href);
    };

    arriveRef.current = () => {
      // The new page is in the DOM: seat it at rest under the glass, then
      // lift the glass off it.
      page.style.transform = "";
      page.style.willChange = "";
      document.documentElement.style.overflowX = "";
      clearAnimations();
      const g = ghost();
      const ms = reducedMotion() ? 0 : IN_MS;
      if (g) {
        const lift = track(
          g.animate(
            [
              { opacity: 1, transform: "translate3d(0,0,0)" },
              { opacity: 0, transform: `translate3d(${-dir * 28}px,0,0)` },
            ],
            { duration: ms, easing: EASE_DISSOLVE, fill: "forwards" },
          ),
        );
        whenDone(lift, ms, () => {
          lift.cancel();
          g.dataset.state = "idle";
          g.style.transform = "";
          g.style.opacity = "";
          animations = animations.filter((a) => a !== lift);
          setGhostTab(null);
        });
      } else {
        setGhostTab(null);
      }
      emitTabDrag(null, false);
    };

    const settle = () => {
      axis = "none";
      if (toIndex != null && shouldCommit(offset, vx, width)) commit();
      else cancelDrag();
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !mql.matches) return;
      if (pendingRef.current || animations.length) return;
      if (document.body.hasAttribute("data-scroll-locked")) return;
      const from = swipeableTabIndex(pathRef.current);
      if (from < 0) return;
      const t = e.target instanceof Element ? e.target : null;
      if (!t || t.closest(NO_SWIPE)) return;
      if (insideHorizontalScroller(t, page)) return;
      const touch = e.touches[0];
      startX = lastX = touch.clientX;
      startY = touch.clientY;
      lastT = e.timeStamp;
      vx = 0;
      axis = "none";
      fromIndex = from;
      active = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!active) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (axis === "none") {
        axis = lockAxis(dx, dy);
        if (axis === "none") return;
        if (axis === "vertical" || !e.cancelable) {
          active = false;
          axis = "none";
          return;
        }
        begin(neighbourIndex(fromIndex, dx, TABS.length), dx < 0 ? 1 : -1);
      }
      if (!e.cancelable) {
        // The browser took the touch for a scroll after all.
        active = false;
        settle();
        return;
      }
      e.preventDefault();
      const dt = e.timeStamp - lastT;
      if (dt > 0) vx = blendVelocity(vx, (touch.clientX - lastX) / dt);
      lastX = touch.clientX;
      lastT = e.timeStamp;
      render(dx);
    };

    const onTouchEnd = () => {
      if (!active) return;
      active = false;
      if (axis !== "horizontal") return;
      settle();
    };

    page.addEventListener("touchstart", onTouchStart, { passive: true });
    page.addEventListener("touchmove", onTouchMove, { passive: false });
    page.addEventListener("touchend", onTouchEnd);
    page.addEventListener("touchcancel", onTouchEnd);
    return () => {
      page.removeEventListener("touchstart", onTouchStart);
      page.removeEventListener("touchmove", onTouchMove);
      page.removeEventListener("touchend", onTouchEnd);
      page.removeEventListener("touchcancel", onTouchEnd);
      const pending = pendingRef.current;
      if (pending) window.clearTimeout(pending.timer);
      pendingRef.current = null;
      finish();
    };
    // Bound once; the current path and route are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tab = ghostTab != null ? TABS[ghostTab] : null;
  const GhostIcon = tab?.icon;

  return (
    <>
      <div ref={pageRef} className="swipe-page flex flex-1 flex-col">
        {children}
      </div>
      <div ref={ghostRef} className="swipe-ghost" data-state="idle" aria-hidden="true">
        {tab && GhostIcon ? (
          <div className="swipe-ghost-badge">
            <span className="swipe-ghost-icon">
              <GhostIcon size={30} strokeWidth={1.9} />
            </span>
            <span className="swipe-ghost-label">{tab.label}</span>
          </div>
        ) : null}
      </div>
    </>
  );
}
