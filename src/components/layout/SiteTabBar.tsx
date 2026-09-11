"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActiveOrderCount } from "@/components/layout/useActiveOrderCount";
import { TABS, activeTabIndex } from "@/components/layout/tabs";
import { TAB_DRAG_EVENT, type TabDragDetail } from "@/lib/motion/swipe-nav";

// Mobile bottom tab bar as a floating pill of frosted glass — the App's
// FloatingTabBar in CSS: clear paper by day, warm grey glass at night, icons
// only, the active one in a window nearly the pill's height that slides
// between tabs, and the whole pill shrinking while the customer reads down
// the page, back the moment they scroll up (the Instagram bar; Rick,
// 2026-09-09). Mobile only (lg:hidden) — desktop uses the SiteHeader nav.
// Gated out of /checkout and /order-confirmation by SiteTabBarGate. Styles
// live in globals.css under .tabbar so the pill and its tokens sit with the
// theme.
//
// prefetch={false} on every link here, and in the other always-visible
// chrome (SiteHeader, MobileAppBar, AccountLink): this bar renders on EVERY
// mobile page, so Next's automatic viewport prefetch fires a full RSC
// round-trip per destination per page view — for pages the customer may
// never open. Measured on production 2026-08-11: one /menu load made 22
// fetches, including /account 5x, /menu 4x and / 3x at 300–450ms each.
// Tapping still streams the route normally; only the speculative fetch is
// gone. Don't "fix" this by removing the prop.
//
// The tabs themselves (order, routes, icons) live in ./tabs — the swipe
// between pages (SwipeNav) walks the same list.

/** Movement smaller than this is a hand at rest, not a direction. */
const DEAD_BAND = 6;
/** Near the top the pill is always whole — a page that has barely moved has
 *  nothing to hide from. */
const TOP_ZONE = 24;

/** Shrunk while the page scrolls down, whole again on the way up or back at
 *  the top — the same rule as the App (lib/motion/chrome). Scroll events
 *  already arrive once a frame, and setState with the same value is free, so
 *  there is nothing to coalesce. */
function useShrinkOnScroll(): boolean {
  const [shrunk, setShrunk] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - lastY;
      lastY = y;
      if (y <= TOP_ZONE) setShrunk(false);
      else if (dy > DEAD_BAND) setShrunk(true);
      else if (dy < -DEAD_BAND) setShrunk(false);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return shrunk;
}

/** While a swipe holds the page (SwipeNav), the window sits where the page
 *  is — a fractional tab, moving live under the finger; when the page
 *  turns it slides on to the new tab at once, before the route lands. Null
 *  when nothing is in hand and the route decides. */
function useTabDrag(): TabDragDetail | null {
  const [drag, setDrag] = useState<TabDragDetail | null>(null);
  useEffect(() => {
    const onDrag = (e: Event) => {
      const detail = (e as CustomEvent<TabDragDetail>).detail;
      setDrag(detail.index == null ? null : detail);
    };
    window.addEventListener(TAB_DRAG_EVENT, onDrag);
    return () => window.removeEventListener(TAB_DRAG_EVENT, onDrag);
  }, []);
  return drag;
}

export function SiteTabBar() {
  const pathname = usePathname() ?? "";
  const orderCount = useActiveOrderCount();
  const activeIndex = activeTabIndex(pathname);
  const shrunk = useShrinkOnScroll();
  const drag = useTabDrag();
  const windowIndex = drag ? drag.index : activeIndex;

  return (
    <nav
      aria-label="Primary"
      className={
        "tabbar lg:hidden" +
        (shrunk ? " is-shrunk" : "") +
        (drag?.live ? " is-dragging" : "")
      }
    >
      {/* The one window slides to the active column (each is 25% wide). */}
      {windowIndex != null && windowIndex >= 0 ? (
        <span
          aria-hidden="true"
          className="tabbar-window"
          style={{ left: `${windowIndex * 25 + 12.5}%` }}
        />
      ) : null}
      {TABS.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        const badge = href === "/account/orders" ? orderCount : 0;
        return (
          <Link
            prefetch={false}
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={
              "press relative z-[1] grid h-full place-items-center rounded-full " +
              (active ? "text-ink" : "text-ink3")
            }
          >
            <span
              key={active ? "on" : "off"}
              className={"relative grid place-items-center " + (active ? "tab-icon-active" : "")}
            >
              <Icon size={22} strokeWidth={active ? 2.4 : 1.9} />
              {badge > 0 && (
                <span className="absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[9.5px] font-bold text-white">
                  {badge}
                </span>
              )}
            </span>
            <span className="sr-only">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
