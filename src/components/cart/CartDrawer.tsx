"use client";

import { useEffect } from "react";
import Link from "next/link";
import {
  useCart,
  lineUnitPrice,
  lineTotal,
  cartSubtotal,
  type CartLine,
} from "@/store/cart";
import { formatPrice } from "@/lib/utils";
import { BRAND } from "@/lib/constants";

// Right-side slide-out drawer. Mounted once in the root layout so it's
// available from every page. Backdrop click and ESC close the drawer.

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
        <header
          className="flex items-center justify-between px-5 py-4 text-white"
          style={{ backgroundColor: BRAND.primaryColor }}
        >
          <h2 className="text-lg font-semibold">Your Cart</h2>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Close cart"
            className="rounded p-1 hover:bg-white/15"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {lines.length === 0 ? (
            <EmptyState onClose={closeDrawer} />
          ) : (
            <ul className="divide-y divide-black/10">
              {lines.map((line) => (
                <CartLineRow
                  key={line.id}
                  line={line}
                  onQuantityChange={(q) => setQuantity(line.id, q)}
                  onRemove={() => removeLine(line.id)}
                />
              ))}
            </ul>
          )}
        </div>

        {lines.length > 0 && <CartFooter lines={lines} />}
      </aside>
    </div>
  );
}

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

function CartLineRow({
  line,
  onQuantityChange,
  onRemove,
}: {
  line: CartLine;
  onQuantityChange: (q: number) => void;
  onRemove: () => void;
}) {
  const unit = lineUnitPrice(line);
  const total = lineTotal(line);
  return (
    <li className="flex gap-3 p-4">
      {line.itemImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={line.itemImageUrl}
          alt=""
          className="h-16 w-16 flex-shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-16 w-16 flex-shrink-0 rounded bg-zinc-100" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900">
              {line.itemName}
            </p>
            {line.variationName && (
              <p className="text-xs text-zinc-500">{line.variationName}</p>
            )}
            {line.modifiers.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {line.modifiers.map((m) => (
                  <li
                    key={m.id}
                    className="truncate text-xs text-zinc-500"
                  >
                    + {m.name}
                    {m.priceCents !== 0n && (
                      <span className="text-zinc-400">
                        {" "}
                        ({formatPrice(m.priceCents)})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove item"
            className="text-xs text-zinc-400 hover:text-zinc-700"
          >
            Remove
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <QuantityStepper
            value={line.quantity}
            onChange={onQuantityChange}
          />
          <div className="text-right">
            <p
              className="text-sm font-semibold"
              style={{ color: BRAND.primaryColor }}
            >
              {formatPrice(total)}
            </p>
            {line.quantity > 1 && (
              <p className="text-[10px] text-zinc-400">
                {formatPrice(unit)} each
              </p>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function QuantityStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (q: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-black/10">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        aria-label="Decrease quantity"
        className="h-7 w-7 rounded-l-full text-sm hover:bg-black/5"
      >
        −
      </button>
      <span className="w-6 text-center text-sm">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        aria-label="Increase quantity"
        className="h-7 w-7 rounded-r-full text-sm hover:bg-black/5"
      >
        +
      </button>
    </div>
  );
}

function CartFooter({ lines }: { lines: CartLine[] }) {
  const subtotal = cartSubtotal(lines);
  const closeDrawer = useCart((s) => s.closeDrawer);
  return (
    <footer className="border-t border-black/10 bg-zinc-50 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm text-zinc-600">Subtotal</span>
        <span className="text-lg font-semibold text-zinc-900">
          {formatPrice(subtotal)}
        </span>
      </div>
      <p className="mb-4 text-[11px] text-zinc-500">
        Taxes and loyalty discounts calculated at checkout.
      </p>
      <Link
        href="/checkout"
        onClick={closeDrawer}
        className="block w-full rounded-full py-3 text-center text-sm font-semibold text-white transition hover:opacity-90"
        style={{ backgroundColor: BRAND.primaryColor }}
      >
        Checkout
      </Link>
    </footer>
  );
}
