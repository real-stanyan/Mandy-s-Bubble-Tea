"use client";

import { useCart, cartItemCount } from "@/store/cart";

// Small cart button with a count badge. Intended for page headers.
// Inverts colors (white on transparent) because all current headers
// have a brand-red background.

export function CartIcon() {
  const lines = useCart((s) => s.lines);
  const hydrated = useCart((s) => s.hydrated);
  const openDrawer = useCart((s) => s.openDrawer);

  // Always render the button to avoid header layout shift. Hide the
  // count badge until hydrated so SSR and client match.
  const count = hydrated ? cartItemCount(lines) : 0;

  return (
    <button
      type="button"
      onClick={openDrawer}
      aria-label={`Open cart (${count} items)`}
      className="relative rounded-full p-2 text-black hover:bg-white/15"
    >
      <CartSvg />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-black px-1 text-[10px] font-bold text-white">
          {count}
        </span>
      )}
    </button>
  );
}

function CartSvg() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}
