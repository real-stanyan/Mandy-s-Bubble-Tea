// The cups the checkout heroes draw for an order: one per unit, in cart
// order, from the same cup-visual mapper the item sheet uses — so the cup
// on the counter is the cup the customer built. Capped; the rest are
// counted on the ticket.
//
// Mirror of the App's lib/menu/order-cups.ts. Keep the two in lockstep.

import { resolveCupVisual, type CupVisual } from "@/lib/menu/cup-visual";

/** How many cups the scenes draw. */
export const HERO_MAX_CUPS = 4;

type OrderLine = { name: string; quantity: number; modifiers: { name: string }[] };

export function orderCups(lines: OrderLine[], max = HERO_MAX_CUPS): CupVisual[] {
  const out: CupVisual[] = [];
  for (const line of lines) {
    const visual = resolveCupVisual({
      drinkName: line.name,
      picked: line.modifiers.map((m) => ({ name: m.name, count: 1 })),
    });
    for (let i = 0; i < Math.max(1, line.quantity); i++) {
      if (out.length >= max) return out;
      out.push(visual);
    }
  }
  return out;
}

/** Cups the order has beyond the ones drawn — the "+N" on the ticket. */
export function extraCups(lines: OrderLine[], max = HERO_MAX_CUPS): number {
  const total = lines.reduce((n, l) => n + Math.max(1, l.quantity), 0);
  return Math.max(0, total - max);
}
