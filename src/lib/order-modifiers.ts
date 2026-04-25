// Square's CreateOrder rejects an OrderLineItem whose `modifiers` array
// contains duplicate `catalog_object_id`s ("INVALID_VALUE / Duplicate
// catalog object ID"). Multi-count toppings (Pearl × 2) reach the server
// flattened to N entries with the same id, so we collapse them into one
// entry with `quantity: "N"` — Square multiplies modifier price by quantity
// automatically.

type IdLike = { id: string };
type SquareModifier = { catalogObjectId: string; quantity?: string };

export function dedupeLineModifiers(modifiers: IdLike[]): SquareModifier[] {
  const counts = new Map<string, number>();
  for (const m of modifiers) {
    counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
  }
  return Array.from(counts, ([id, count]) => {
    const out: SquareModifier = { catalogObjectId: id };
    if (count > 1) out.quantity = String(count);
    return out;
  });
}
