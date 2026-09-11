import { Home, LayoutGrid, ReceiptText, User, type LucideIcon } from "lucide-react";

// The four mobile tabs, in the order they sit in the pill — and the order
// the pages come in when the customer swipes (SwipeNav): Home, Menu,
// Orders, Account, the same as the App.

export type Tab = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Whether a pathname lights this tab (the item detail keeps Menu lit). */
  match: (pathname: string) => boolean;
};

export const TABS: readonly Tab[] = [
  { href: "/", label: "Home", icon: Home, match: (p) => p === "/" },
  {
    href: "/menu",
    label: "Menu",
    icon: LayoutGrid,
    // Item detail (modal/route) lives under /menu — keep Menu lit.
    match: (p) => p === "/menu" || p.startsWith("/menu/"),
  },
  {
    href: "/account/orders",
    label: "Orders",
    icon: ReceiptText,
    match: (p) => p.startsWith("/account/orders"),
  },
  {
    href: "/account",
    label: "Account",
    icon: User,
    // Account, but not the Orders sub-route (handled above).
    match: (p) => p === "/account",
  },
];

/** The tab this pathname lights, or -1. */
export function activeTabIndex(pathname: string): number {
  return TABS.findIndex((t) => t.match(pathname));
}

/** The tab this pathname IS — only a tab root can be swiped away from; an
 *  item sheet over the menu or a sub-page of Account cannot. */
export function swipeableTabIndex(pathname: string): number {
  return TABS.findIndex((t) => t.href === pathname);
}
