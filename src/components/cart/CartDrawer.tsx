"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  useCart,
  lineTotal,
  cartSubtotal,
  type CartLine,
} from "@/store/cart";
import { formatPrice } from "@/lib/utils";
import { BRAND, LOYALTY } from "@/lib/constants";

// Right-side slide-out drawer. Mounted once in the root layout so it's
// available from every page. Backdrop click and ESC close the drawer.

const PHONE_STORAGE_KEY = "mbt:account:phone";

export function CartDrawer() {
  const isOpen = useCart((s) => s.isOpen);
  const hydrated = useCart((s) => s.hydrated);
  const lines = useCart((s) => s.lines);
  const closeDrawer = useCart((s) => s.closeDrawer);
  const setQuantity = useCart((s) => s.setQuantity);
  const removeLine = useCart((s) => s.removeLine);

  // Close on ESC.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, closeDrawer]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  // Avoid SSR hydration mismatch — server renders nothing for this drawer.
  if (!hydrated) return null;

  const itemCount = lines.reduce((n, l) => n + l.quantity, 0);

  return (
    <div
      aria-hidden={!isOpen}
      className={`fixed inset-0 z-50 ${
        isOpen ? "pointer-events-auto" : "pointer-events-none"
      }`}
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity ${
          isOpen ? "opacity-100" : "opacity-0"
        }`}
        onClick={closeDrawer}
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-label="Shopping cart"
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-xl transition-transform ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <header className="flex items-start justify-between px-5 pt-6 pb-4">
          <div>
            <h2 className="text-xl font-bold text-zinc-900">Your Cart</h2>
            <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              {itemCount} item{itemCount !== 1 ? "s" : ""} selected
            </p>
          </div>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Close cart"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 text-sm text-zinc-500 transition hover:bg-zinc-50"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5">
          {lines.length === 0 ? (
            <EmptyState onClose={closeDrawer} />
          ) : (
            <>
              {/* Tea Journey loyalty card */}
              <TeaJourneyCard />

              {/* Cart items */}
              <div className="mt-5 space-y-5">
                {lines.map((line) => (
                  <CartLineRow
                    key={line.id}
                    line={line}
                    onQuantityChange={(q) => setQuantity(line.id, q)}
                    onRemove={() => removeLine(line.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {lines.length > 0 && <CartFooter lines={lines} />}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tea Journey (loyalty progress)                                     */
/* ------------------------------------------------------------------ */

function TeaJourneyCard() {
  const [balance, setBalance] = useState<number | null>(null);
  const starsPerReward = LOYALTY.starsPerReward;

  useEffect(() => {
    const phone =
      typeof window !== "undefined"
        ? window.localStorage.getItem(PHONE_STORAGE_KEY)
        : null;
    if (!phone) return;

    (async () => {
      try {
        const custRes = await fetch("/api/customer/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone }),
        });
        const custJson = await custRes.json();
        if (!custRes.ok || !custJson.ok || !custJson.found) return;

        const loyaltyRes = await fetch("/api/loyalty/account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId: custJson.customerId,
            phone: custJson.phoneE164,
          }),
        });
        const loyaltyJson = await loyaltyRes.json();
        if (loyaltyRes.ok && loyaltyJson.ok) {
          setBalance(loyaltyJson.balance ?? 0);
        }
      } catch {
        // Silently fail — loyalty is optional
      }
    })();
  }, []);

  const stars = balance ?? 0;
  const remaining = Math.max(starsPerReward - stars, 0);
  const progressPct = Math.min((stars / starsPerReward) * 100, 100);

  return (
    <div
      className="rounded-2xl p-4"
      style={{ backgroundColor: BRAND.accentColor }}
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-bold text-zinc-900">Your Tea Journey</h3>
          <p className="mt-0.5 text-xs text-zinc-600">
            {stars > 0
              ? `${remaining} more star${remaining !== 1 ? "s" : ""} until your next free treat!`
              : "Start earning stars toward a free drink!"}
          </p>
        </div>
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: BRAND.primaryColor }}
        >
          <StarIcon />
        </span>
      </div>
      {/* Progress bar */}
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/60">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${progressPct}%`,
            backgroundColor: BRAND.primaryColor,
          }}
        />
      </div>
      <div className="mt-1.5 text-[10px] font-semibold text-zinc-500">
        <span>
          {stars} / {starsPerReward} Stars
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

function EmptyState({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <p className="text-base text-zinc-600">Your cart is empty.</p>
      <Link
        href="/menu"
        onClick={onClose}
        className="rounded-full px-5 py-2 text-sm font-medium text-white"
        style={{ backgroundColor: BRAND.primaryColor }}
      >
        Browse menu
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Cart line row                                                      */
/* ------------------------------------------------------------------ */

function CartLineRow({
  line,
  onQuantityChange,
  onRemove,
}: {
  line: CartLine;
  onQuantityChange: (q: number) => void;
  onRemove: () => void;
}) {
  const total = lineTotal(line);
  const details = [
    line.variationName,
    ...line.modifiers.map((m) => m.name),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="flex gap-3">
      {/* Image */}
      {line.itemImageUrl ? (
        <img
          src={line.itemImageUrl}
          alt=""
          className="h-16 w-16 shrink-0 rounded-xl object-cover"
        />
      ) : (
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl text-lg"
          style={{ backgroundColor: BRAND.accentColor }}
        >
          🧋
        </div>
      )}

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-bold text-zinc-900">{line.itemName}</p>
          <p
            className="shrink-0 text-sm font-bold"
            style={{ color: BRAND.primaryColor }}
          >
            {formatPrice(total)}
          </p>
        </div>
        {details && (
          <p className="mt-0.5 text-xs text-zinc-500">{details}</p>
        )}

        {/* Quantity + Remove */}
        <div className="mt-2 flex items-center justify-between">
          <QuantityStepper value={line.quantity} onChange={onQuantityChange} />
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove item"
            className="text-xs font-medium transition hover:opacity-70"
            style={{ color: BRAND.primaryColor }}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Quantity stepper                                                    */
/* ------------------------------------------------------------------ */

function QuantityStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (q: number) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-black/10">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        aria-label="Decrease quantity"
        className="flex h-7 w-7 items-center justify-center rounded-l-full text-sm text-zinc-600 hover:bg-black/5"
      >
        −
      </button>
      <span className="w-6 text-center text-sm font-medium">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        aria-label="Increase quantity"
        className="flex h-7 w-7 items-center justify-center rounded-r-full text-sm text-zinc-600 hover:bg-black/5"
      >
        +
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Footer                                                             */
/* ------------------------------------------------------------------ */

function CartFooter({ lines }: { lines: CartLine[] }) {
  const subtotal = cartSubtotal(lines);
  const closeDrawer = useCart((s) => s.closeDrawer);
  return (
    <footer className="border-t border-black/10 px-5 pb-6 pt-5">
      <div className="space-y-2">
        <div className="flex justify-between text-sm text-zinc-600">
          <span>Subtotal</span>
          <span className="font-semibold text-zinc-900">
            {formatPrice(subtotal)}
          </span>
        </div>
        <div className="flex justify-between text-sm text-zinc-600">
          <span>Tax</span>
          <span className="font-semibold text-zinc-900">
            At checkout
          </span>
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between border-t border-black/10 pt-3">
        <span className="text-base font-bold text-zinc-900">Total Price</span>
        <span
          className="text-xl font-bold"
          style={{ color: BRAND.primaryColor }}
        >
          {formatPrice(subtotal)}
        </span>
      </div>
      <Link
        href="/checkout"
        onClick={closeDrawer}
        className="mt-5 block w-full rounded-full py-3.5 text-center text-sm font-semibold text-white transition hover:opacity-90"
        style={{ backgroundColor: BRAND.primaryColor }}
      >
        Checkout Now
      </Link>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

function StarIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}
