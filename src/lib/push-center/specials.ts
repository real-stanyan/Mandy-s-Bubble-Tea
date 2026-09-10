// Push Center — wording for the weekly specials push, from the shelf and its
// live prices. Pure; the Square lookup is in specials.server.ts.

import { createHash } from "node:crypto";
import { normalizeItemName } from "@/lib/menu/weekly-specials";

export type SpecialItem = { name: string; priceCents: number; originalCents: number };

export type SpecialsDraft = {
  items: SpecialItem[];
  /** Config names not found in the live catalog — stale or misspelt. */
  missing: string[];
  /** "Strawberry Slushy & Guava Iced Green Tea", or a priced list when prices differ. */
  itemsText: string;
  /** "now $4.60 (was $6.20)" when one price fits all, else "from $4.60". */
  priceText: string;
  /** Names + live prices; the send refuses when it no longer matches the preview. */
  fingerprint: string;
};

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

export function composeSpecials(items: SpecialItem[], missing: string[]): SpecialsDraft {
  const prices = new Set(items.map((i) => i.priceCents));
  const originals = new Set(items.map((i) => i.originalCents));
  let itemsText = "";
  let priceText = "";
  if (items.length > 0 && prices.size === 1) {
    itemsText = joinNames(items.map((i) => i.name));
    const price = dollars(items[0].priceCents);
    priceText =
      originals.size === 1 && items[0].originalCents > items[0].priceCents
        ? `now ${price} (was ${dollars(items[0].originalCents)})`
        : `now ${price}`;
  } else if (items.length > 0) {
    itemsText = joinNames(items.map((i) => `${i.name} ${dollars(i.priceCents)}`));
    priceText = `from ${dollars(Math.min(...prices))}`;
  }
  const fingerprint = createHash("sha1")
    .update(JSON.stringify(items.map((i) => [normalizeItemName(i.name), i.priceCents])))
    .digest("hex")
    .slice(0, 16);
  return { items, missing, itemsText, priceText, fingerprint };
}
