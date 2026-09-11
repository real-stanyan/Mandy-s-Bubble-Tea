"use client";

import { ShoppingBag } from "lucide-react";
import { useCart, cartItemCount, cartSubtotal } from "@/store/cart";
import { formatPrice } from "@/lib/utils";
import { capsuleWidth } from "@/lib/motion/cart-dock";

// The bag, as the right-hand end of the bottom dock (SiteTabBar): a
// capsule the height of the tab pill, in the brand colour, with the bag
// glyph, how many drinks are in it, and the total. A tap opens the cart
// drawer. While the bag is empty there is no capsule and the pill has the
// row; the first drink slides it in from the right edge as the pill makes
// room (globals.css .bagpill), another drink bumps it. The App's
// CartCapsule, in CSS — the two docks are meant to read as one design
// (Rick, 2026-09-11).
//
// Rendered whether the bag is empty or not: the slide is a transition on
// one element, so the element has to be there to transition. Shut, it has
// no width, takes no pointer, and is hidden from assistive tech.

export function BagPill() {
  const lines = useCart((s) => s.lines);
  const hydrated = useCart((s) => s.hydrated);
  const openDrawer = useCart((s) => s.openDrawer);
  // No badge until hydrated, so SSR and the client agree.
  const count = hydrated ? cartItemCount(lines) : 0;
  const label = formatPrice(cartSubtotal(lines));
  const shut = count === 0;

  return (
    <button
      type="button"
      onClick={openDrawer}
      aria-label={`Bag, ${count} ${count === 1 ? "drink" : "drinks"}, ${label}. View cart.`}
      aria-hidden={shut || undefined}
      tabIndex={shut ? -1 : 0}
      className={"bagpill" + (shut ? " is-shut" : "")}
      style={{ "--bag-w": `${capsuleWidth(label)}px` } as React.CSSProperties}
    >
      {/* Re-keyed on the count: a drink joining bumps the capsule and pops
          the badge (the same cues as the App's). */}
      <span key={count} className="bag-bump flex items-center gap-2.5">
        <span className="relative grid h-5 w-5 place-items-center">
          <ShoppingBag size={20} strokeWidth={2} aria-hidden="true" />
          <span className="badge-pop bagpill-badge">{count > 99 ? "99+" : count}</span>
        </span>
        <span className="font-mono text-[14px] font-bold tracking-[-0.2px]">{label}</span>
      </span>
    </button>
  );
}
