"use client";

import { usePathname } from "next/navigation";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { MobileAppBar } from "@/components/layout/MobileAppBar";

// Renders the shared chrome on every route except those where it would get
// in the way. The desktop nav (SiteHeader) and the mobile app bar
// (MobileAppBar) each show at their own breakpoint. Currently only
// /checkout is excluded — that flow has its own focused chrome.

const HIDE_PREFIXES = ["/checkout"];

export function SiteHeaderGate() {
  const pathname = usePathname() ?? "";
  const hidden = HIDE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (hidden) return null;
  return (
    <>
      <MobileAppBar />
      <SiteHeader />
    </>
  );
}
