import type { CartLine } from "@/store/cart";

// NOTE: cup labels are OPTIONAL. We deliberately do NOT pre-fill cups with a
// random gallery sticker any more. A cup left untouched carries no selection,
// and the server (enqueue.ts → drawLuckyCat) prints a random 招财猫 at print
// time — which is exactly what we now tell the customer ("skip it for a
// surprise lucky cat 🐱"). Pre-filling a concrete sticker made the picker look
// mandatory and silently overrode that lucky-cat fallback, so it was removed.

export function flattenCups(
  lines: CartLine[],
): Array<{
  lineId: string;
  cupIdx: number;
  itemName: string;
  variationName: string;
  totalCups: number;
}> {
  const out = [];
  for (const line of lines) {
    for (let i = 0; i < line.quantity; i++) {
      out.push({
        lineId: line.id,
        cupIdx: i,
        itemName: line.itemName,
        variationName: line.variationName,
        totalCups: line.quantity,
      });
    }
  }
  return out;
}
