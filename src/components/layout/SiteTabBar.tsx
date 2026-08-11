"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, ReceiptText, User } from "lucide-react";
import { useActiveOrderCount } from "@/components/layout/useActiveOrderCount";

// Mobile bottom tab bar, recreated from the phone prototype
// (components.jsx TabBar): Home / Menu / Orders / Account. Mobile only
// (lg:hidden) — desktop uses the SiteHeader nav. Fixed to the bottom with a
// paper fade and safe-area padding. Gated out of /checkout and
// /order-confirmation by SiteTabBarGate, matching the prototype.
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

export function SiteTabBar() {
  const pathname = usePathname() ?? "";
  const orderCount = useActiveOrderCount();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around bg-gradient-to-t from-paper from-70% to-transparent px-3.5 pb-[max(env(safe-area-inset-bottom),12px)] pt-2 lg:hidden"
    >
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
              "flex flex-col items-center gap-[3px] rounded-tile px-3.5 py-1.5 transition " +
              (active ? "text-brand" : "text-ink3")
            }
          >
            <span className="relative grid place-items-center">
              <Icon size={22} />
              {badge > 0 && (
                <span className="absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full border-2 border-paper bg-green px-1 text-[9.5px] font-bold text-white">
                  {badge}
                </span>
              )}
            </span>
            <span className="text-[10px] font-semibold tracking-[0.2px]">
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
