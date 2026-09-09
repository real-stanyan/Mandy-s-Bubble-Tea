"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, ReceiptText, User } from "lucide-react";
import { useActiveOrderCount } from "@/components/layout/useActiveOrderCount";

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

const TABS = [
  { href: "/", label: "Home", icon: Home, match: (p: string) => p === "/" },
  {
    href: "/menu",
    label: "Menu",
    icon: LayoutGrid,
    // Item detail (modal/route) lives under /menu — keep Menu lit.
    match: (p: string) => p === "/menu" || p.startsWith("/menu/"),
  },
  {
    href: "/account/orders",
    label: "Orders",
    icon: ReceiptText,
    match: (p: string) => p.startsWith("/account/orders"),
  },
  {
    href: "/account",
    label: "Account",
    icon: User,
    // Account, but not the Orders sub-route (handled above).
    match: (p: string) => p === "/account",
  },
];

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

export function SiteTabBar() {
  const pathname = usePathname() ?? "";
  const orderCount = useActiveOrderCount();
  const activeIndex = TABS.findIndex((t) => t.match(pathname));
  const shrunk = useShrinkOnScroll();

  return (
    <nav
      aria-label="Primary"
      className={"tabbar lg:hidden" + (shrunk ? " is-shrunk" : "")}
    >
      {/* The one window slides to the active column (each is 25% wide). */}
      {activeIndex >= 0 ? (
        <span
          aria-hidden="true"
          className="tabbar-window"
          style={{ left: `${activeIndex * 25 + 12.5}%` }}
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
