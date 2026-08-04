"use client";

import { usePathname } from "next/navigation";
import { CartDrawer } from "@/components/cart/CartDrawer";

// Matches the other chrome gates: /staff is an internal tool, and a cart has
// no meaning while someone is counting syrup bottles or building a roster.

const HIDE_PREFIXES = ["/staff"];

export function CartDrawerGate() {
  const pathname = usePathname() ?? "";
  const hidden = HIDE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (hidden) return null;
  return <CartDrawer />;
}
