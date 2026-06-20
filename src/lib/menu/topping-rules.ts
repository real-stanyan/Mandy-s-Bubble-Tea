// Topping-cap exemptions.
//
// House rule: a customer may add up to 3 DIFFERENT toppings (maxDistinct=3),
// each up to maxPerKind. Oreo is exempt — it can be added in any quantity AND
// does not count toward the "3 different toppings" limit.
//
// Matched by name (case-insensitive substring) so Square renames with a suffix
// like "Oreo (New)" still qualify. A Square rename away from "Oreo" would make
// this a safe no-op (Oreo would simply rejoin the normal cap).

export function isUncountedTopping(name: string): boolean {
  return name.trim().toLowerCase().includes("oreo");
}

// Distinct count that drives the maxDistinct cap: each picked modifier counts
// once, EXCLUDING uncounted toppings (Oreo). Quantity is ignored — this is a
// "how many different kinds" count, not a total. Works for any modifier list:
// lists without Oreo behave exactly like a plain distinct count.
export function cappedDistinctCount(
  modifiers: { id: string; name: string }[],
  counts: Record<string, number>,
): number {
  let n = 0;
  for (const mod of modifiers) {
    if ((counts[mod.id] ?? 0) > 0 && !isUncountedTopping(mod.name)) n += 1;
  }
  return n;
}
