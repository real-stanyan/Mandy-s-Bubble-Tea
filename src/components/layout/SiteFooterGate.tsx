"use client";

import { usePathname } from "next/navigation";
import { SiteFooter } from "@/components/layout/SiteFooter";

// /staff is an internal tool, not part of the shop: the customer footer,
// tab bar and cart drawer are noise there and its links lead back out of it.
const HIDE_PREFIXES = ["/checkout", "/staff"];

export function SiteFooterGate() {
  const pathname = usePathname() ?? "";
  const hidden = HIDE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (hidden) return null;
  return <SiteFooter />;
}
