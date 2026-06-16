"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { CartIcon } from "@/components/cart/CartIcon";
import { AccountLink } from "@/components/layout/AccountLink";
import { getStoreStatus, type StoreStatus } from "@/lib/store-status";

// Shared site header, recreated from the design (web-components.jsx
// NavBar): logo, Home / Menu / Orders / Our Story links, a live store
// status pill, cart, an "Order now" CTA, and the account affordance.
// On mobile, primary navigation lives in the bottom SiteTabBar (matching
// the phone prototype), so the header here drops the desktop nav links and
// keeps just the logo, cart and "Order now".

const NAV_LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Home" },
  { href: "/menu", label: "Menu" },
  { href: "/account/orders", label: "Orders" },
  { href: "/our-story", label: "Our Story" },
];

export function SiteHeader() {
  const pathname = usePathname();
  // Lazy-init (like MenuHeader) so we never setState directly in an effect.
  const [status, setStatus] = useState<StoreStatus>(() =>
    getStoreStatus(new Date()),
  );

  useEffect(() => {
    const id = setInterval(() => setStatus(getStoreStatus(new Date())), 60_000);
    return () => clearInterval(id);
  }, []);

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-line bg-bg/85 shadow-[0_4px_16px_rgba(42,30,20,0.05)] backdrop-blur-md">
      <div className="mx-auto flex h-[74px] max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" aria-label="Mandy's home" className="shrink-0">
          <Image
            src="/logo.webp"
            width={200}
            height={200}
            alt="Mandy's Bubble Tea"
            className="h-11 w-auto"
          />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={
                "rounded-full px-3.5 py-2 text-[14.5px] font-semibold transition " +
                (isActive(l.href)
                  ? "text-brand"
                  : "text-ink2 hover:bg-[rgba(42,30,20,0.04)]")
              }
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Right cluster */}
        <div className="flex items-center gap-2 sm:gap-3">
          <span
            className={
              "hidden items-center gap-1.5 text-[13px] font-semibold xl:inline-flex " +
              (status.open ? "text-green-dark" : "text-ink2")
            }
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                backgroundColor: status.open ? "#3CA96E" : "rgba(42,30,20,0.28)",
              }}
            />
            {status.open ? "Open now" : "Closed"}
          </span>
          <CartIcon />
          <Link
            href="/menu"
            className="hidden items-center gap-1.5 rounded-full bg-brand px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-[0_10px_18px_rgba(141,85,36,0.28)] transition hover:bg-brand-dark active:scale-[0.97] sm:inline-flex"
          >
            Order now <ArrowRight size={15} />
          </Link>
          <AccountLink className="hidden rounded-full border border-line bg-card px-4 py-2.5 text-[13.5px] font-semibold text-ink2 transition hover:bg-paper lg:inline-flex" />
        </div>
      </div>
    </header>
  );
}
