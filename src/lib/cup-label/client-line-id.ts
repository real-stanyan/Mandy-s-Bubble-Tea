import "server-only";
import type { OrderLineItem } from "square";

// Mirrors the RN cart's buildLineId (store/cart.ts):
//   variationId + "::" + sorted(modifierIds).join(",")
export function clientLineIdFromSquareLine(line: OrderLineItem): string {
  const variationId = line.catalogObjectId ?? "";
  const modIds = (line.modifiers ?? [])
    .map(m => m.catalogObjectId ?? "")
    .filter(Boolean)
    .sort();
  return `${variationId}::${modIds.join(",")}`;
}
