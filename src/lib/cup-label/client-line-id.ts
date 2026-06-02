import "server-only";
import type { OrderLineItem } from "square";

// Mirrors the RN cart's buildLineId (store/cart.ts):
//   variationId + "::" + sorted(modifierIds).join(",")
//
// Wrinkle: the cart stores N separate entries for N copies of the same
// modifier (e.g. Pearls × 2 → 2 cart-modifier entries). /api/orders
// dedupes those before sending to Square (commit 64753f9), collapsing
// them into a single OrderLineItemModifier with quantity:"2". To get
// back to the original cart key here, we expand by quantity.
export function clientLineIdFromSquareLine(line: OrderLineItem): string {
  const variationId = line.catalogObjectId ?? "";
  const modIds: string[] = [];
  for (const m of line.modifiers ?? []) {
    const id = m.catalogObjectId;
    if (!id) continue;
    const qty = Math.max(1, parseInt(m.quantity ?? "1", 10) || 1);
    for (let i = 0; i < qty; i++) modIds.push(id);
  }
  modIds.sort();
  return `${variationId}::${modIds.join(",")}`;
}
