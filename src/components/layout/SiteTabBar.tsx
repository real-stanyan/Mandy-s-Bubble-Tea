"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutGrid, ReceiptText, User } from "lucide-react";

// Mobile bottom tab bar, recreated from the phone prototype
// (components.jsx TabBar): Home / Menu / Orders / Account. Mobile only
// (lg:hidden) — desktop uses the SiteHeader nav. Fixed to the bottom with a
// paper fade and safe-area padding. Gated out of /checkout and
// /order-confirmation by SiteTabBarGate, matching the prototype.

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

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around bg-gradient-to-t from-paper from-70% to-transparent px-3.5 pb-[max(env(safe-area-inset-bottom),12px)] pt-2 lg:hidden"
    >
      {TABS.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={
              "flex flex-col items-center gap-[3px] rounded-tile px-3.5 py-1.5 transition " +
              (active ? "text-brand" : "text-ink3")
            }
          >
            <Icon size={22} />
            <span className="text-[10px] font-semibold tracking-[0.2px]">
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
