"use client";

import { usePathname } from "next/navigation";
import { SiteTabBar } from "@/components/layout/SiteTabBar";

// Mirrors the phone prototype: the bottom tab bar shows everywhere on mobile
// except the focused checkout and order-confirmation flows.
const HIDE_PREFIXES = ["/checkout", "/order-confirmation", "/staff"];

export function SiteTabBarGate() {
  const pathname = usePathname() ?? "";
  const hidden = HIDE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (hidden) return null;
  return (
    <>
      {/* Spacer keeps page content / footer clear of the fixed bar on mobile. */}
      <div aria-hidden className="h-[68px] lg:hidden" />
      <SiteTabBar />
    </>
  );
}
