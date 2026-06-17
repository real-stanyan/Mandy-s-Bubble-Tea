"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ChevronLeft, ReceiptText, ShoppingCart } from "lucide-react";
import { useCart, cartItemCount } from "@/store/cart";
import { useActiveOrderCount } from "@/components/layout/useActiveOrderCount";

// Mobile top app bar, recreated from the phone prototype (components.jsx
// AppBar). Per-route: the home screen shows the logo; list screens show a
// serif page title (+subtitle); detail screens show a back button + title.
// A round cart button with a brand count badge sits on the right. Mobile
// only (lg:hidden) — desktop uses the full SiteHeader nav.

type Bar =
  | { kind: "logo" }
  | { kind: "title"; title: string; subtitle?: string }
  | { kind: "back"; title: string; backHref: string };

function resolveBar(pathname: string): Bar {
  if (pathname === "/") return { kind: "logo" };
  if (pathname === "/menu")
    return { kind: "title", title: "Menu", subtitle: "Mandy's · Southport" };
  if (pathname.startsWith("/menu/"))
    return { kind: "back", title: "Menu", backHref: "/menu" };
  if (pathname === "/checkout" || pathname.startsWith("/checkout/"))
    return { kind: "back", title: "Checkout", backHref: "/menu" };
  if (pathname.startsWith("/account/orders"))
    return { kind: "title", title: "Orders", subtitle: "Mandy's · Southport" };
  if (pathname.startsWith("/account")) return { kind: "title", title: "Account" };
  if (pathname === "/our-story")
    return { kind: "back", title: "Our Story", backHref: "/" };
  if (pathname.startsWith("/order-confirmation"))
    return { kind: "back", title: "Order", backHref: "/" };
  return { kind: "logo" };
}

function OrdersButton() {
  const count = useActiveOrderCount();
  if (count <= 0) return null;
  return (
    <Link
      href="/account/orders"
      aria-label={`${count} order${count !== 1 ? "s" : ""} in progress`}
      className="relative grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full border border-line bg-card text-ink2"
    >
      <ReceiptText size={19} />
      <span className="absolute -right-1 -top-1 grid h-[19px] min-w-[19px] place-items-center rounded-full border-2 border-bg bg-green px-1 text-[10.5px] font-bold text-white">
        {count}
      </span>
    </Link>
  );
}

function CartButton() {
  const lines = useCart((s) => s.lines);
  const hydrated = useCart((s) => s.hydrated);
  const openDrawer = useCart((s) => s.openDrawer);
  const count = hydrated ? cartItemCount(lines) : 0;

  return (
    <button
      type="button"
      onClick={openDrawer}
      aria-label={`Open cart (${count} items)`}
      className="relative grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full border border-line bg-card text-ink2"
    >
      <ShoppingCart size={19} />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 grid h-[19px] min-w-[19px] place-items-center rounded-full border-2 border-bg bg-brand px-1 text-[10.5px] font-bold text-white">
          {count}
        </span>
      )}
    </button>
  );
}

function TitleBlock({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-serif text-[21px] font-semibold leading-tight tracking-[-0.3px] text-ink">
        {title}
      </div>
      {subtitle && <div className="text-[11px] text-ink3">{subtitle}</div>}
    </div>
  );
}

export function MobileAppBar() {
  const pathname = usePathname() ?? "/";
  const bar = resolveBar(pathname);

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-3 bg-bg/90 px-[18px] pb-3 pt-[max(env(safe-area-inset-top),14px)] backdrop-blur-md lg:hidden">
      <div className="flex min-w-0 items-center gap-2.5">
        {bar.kind === "logo" && (
          <Link href="/" aria-label="Mandy's home">
            <Image
              src="/logo.webp"
              width={160}
              height={160}
              alt="Mandy's Bubble Tea"
              className="h-[38px] w-auto"
            />
          </Link>
        )}
        {bar.kind === "back" && (
          <>
            <Link
              href={bar.backHref}
              aria-label="Back"
              className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full border border-line bg-card text-ink2"
            >
              <ChevronLeft size={19} />
            </Link>
            <TitleBlock title={bar.title} />
          </>
        )}
        {bar.kind === "title" && (
          <TitleBlock title={bar.title} subtitle={bar.subtitle} />
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <OrdersButton />
        <CartButton />
      </div>
    </header>
  );
}
