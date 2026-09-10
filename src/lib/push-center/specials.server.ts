import "server-only";
import { squareClient } from "@/lib/square";
import { WEEKLY_SPECIALS, normalizeItemName } from "@/lib/menu/weekly-specials";
import { composeSpecials, type SpecialItem, type SpecialsDraft } from "./specials";

export type { SpecialItem, SpecialsDraft } from "./specials";

// Push Center — the weekly specials push is drafted from the shelf config and
// the LIVE Square prices, never typed. The 9/7 broadcast quoted "$4.60 (was
// $6.20)" by hand behind a price-guard script; here the guard is the
// fingerprint: the preview carries it, the send recomputes it, and a price
// that moved in between refuses the send.

export async function draftSpecials(): Promise<SpecialsDraft> {
  const wanted = new Map(WEEKLY_SPECIALS.map((s) => [normalizeItemName(s.name), s]));
  const found = new Map<string, SpecialItem>();
  const page = await squareClient.catalog.list({ types: "ITEM" });
  for await (const obj of page) {
    if (obj.type !== "ITEM" || obj.isDeleted) continue;
    const name = obj.itemData?.name ?? "";
    const key = normalizeItemName(name);
    const spec = wanted.get(key);
    if (!spec || found.has(key)) continue;
    // Variations are CatalogObjects themselves; the price lives on the
    // ITEM_VARIATION member of the union.
    const variation = obj.itemData?.variations?.[0];
    const amount =
      variation?.type === "ITEM_VARIATION" ? variation.itemVariationData?.priceMoney?.amount : undefined;
    if (amount === undefined || amount === null) continue;
    found.set(key, { name, priceCents: Number(amount), originalCents: spec.originalPriceCents });
  }
  // Shelf order, as /menu shows it.
  const items: SpecialItem[] = [];
  const missing: string[] = [];
  for (const s of WEEKLY_SPECIALS) {
    const hit = found.get(normalizeItemName(s.name));
    if (hit) items.push(hit);
    else missing.push(s.name);
  }
  return composeSpecials(items, missing);
}
