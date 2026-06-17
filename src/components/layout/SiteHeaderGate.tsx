"use client";

import { usePathname } from "next/navigation";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { MobileAppBar } from "@/components/layout/MobileAppBar";

// Renders the shared chrome on every route. The desktop nav (SiteHeader) and
// the mobile app bar (MobileAppBar) each show at their own breakpoint.
// /checkout is a focused flow: it keeps the mobile app bar (back + "Checkout"
// + cart, per the phone prototype) but drops the full desktop nav so the page
// stays distraction-free on wide screens.

const FOCUSED_PREFIXES = ["/checkout"];

export function SiteHeaderGate() {
  const pathname = usePathname() ?? "";
  const focused = FOCUSED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  return (
    <>
      <MobileAppBar />
      {!focused && <SiteHeader />}
    </>
  );
}
