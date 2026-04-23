"use client";

import { usePathname } from "next/navigation";
import { SiteHeader } from "@/components/layout/SiteHeader";

// Renders the shared SiteHeader on every route except those where it
// would get in the way. Currently only /checkout is excluded — that
// flow has its own focused chrome. Add more prefixes here if future
// routes need a clean canvas.

const HIDE_PREFIXES = ["/checkout"];

export function SiteHeaderGate() {
  const pathname = usePathname() ?? "";
  const hidden = HIDE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (hidden) return null;
  return <SiteHeader />;
}
