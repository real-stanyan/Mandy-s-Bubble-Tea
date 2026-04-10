"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BRAND } from "@/lib/constants";
import { CartIcon } from "@/components/cart/CartIcon";
import { AccountLink } from "@/components/layout/AccountLink";
import Image from "next/image";

// Shared site header — brand wordmark on the left, primary nav
// (Home / Menu / Account / Cart) on the right. Active link gets
// highlighted with the brand color. Mobile: hamburger menu.

export function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close mobile menu on route change.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Lock body scroll while mobile menu is open.
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  function navClass(href: string) {
    const active =
      href === "/" ? pathname === "/" : pathname.startsWith(href);
    return active
      ? "font-semibold"
      : "opacity-70 hover:opacity-100";
  }

  function navStyle(href: string) {
    const active =
      href === "/" ? pathname === "/" : pathname.startsWith(href);
    return active ? { color: BRAND.primaryColor } : undefined;
  }

  return (
    <header
      className="w-full px-4 py-3 text-black shadow-md sm:px-6 sm:py-5"
      style={{ backgroundColor: BRAND.bgColor }}
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <Link
          href="/"
          className="shrink-0 text-lg font-semibold tracking-tight hover:opacity-90"
        >
          <Image
            src="/logo.webp"
            width={200}
            height={200}
            alt=""
            className="h-12 w-auto sm:h-16"
          />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-5 text-sm sm:flex">
          <Link href="/" className={navClass("/")} style={navStyle("/")}>
            Home
          </Link>
          <Link href="/menu" className={navClass("/menu")} style={navStyle("/menu")}>
            Menu
          </Link>
          <AccountLink className={navClass("/account")} style={navStyle("/account")} />
          <CartIcon />
        </nav>

        {/* Mobile: cart + hamburger */}
        <div className="flex items-center gap-3 sm:hidden">
          <CartIcon />
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-700 transition hover:bg-black/5"
          >
            {menuOpen ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu overlay */}
      {menuOpen && (
        <div className="fixed inset-0 top-[60px] z-40 bg-black/40 sm:hidden" onClick={() => setMenuOpen(false)}>
          <nav
            className="flex flex-col gap-1 border-t border-black/10 bg-white px-5 py-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <Link
              href="/"
              className={`rounded-lg px-4 py-3 text-base font-medium transition hover:bg-black/5 ${navClass("/")}`}
              style={navStyle("/")}
            >
              Home
            </Link>
            <Link
              href="/menu"
              className={`rounded-lg px-4 py-3 text-base font-medium transition hover:bg-black/5 ${navClass("/menu")}`}
              style={navStyle("/menu")}
            >
              Menu
            </Link>
            <div className="rounded-lg px-4 py-3">
              <AccountLink className={`text-base font-medium ${navClass("/account")}`} style={navStyle("/account")} />
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
