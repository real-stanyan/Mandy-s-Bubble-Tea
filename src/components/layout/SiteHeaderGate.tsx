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

// /staff is an internal tool rather than part of the shop, so it drops the
// customer chrome entirely — the app bar's links lead back out of it, and the
// cart has no meaning while someone is counting syrup bottles.
const INTERNAL_PREFIXES = ["/staff"];

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function SiteHeaderGate() {
  const pathname = usePathname() ?? "";
  if (matches(pathname, INTERNAL_PREFIXES)) return null;
  const focused = matches(pathname, FOCUSED_PREFIXES);
  return (
    <>
      <MobileAppBar />
      {!focused && <SiteHeader />}
    </>
  );
}
