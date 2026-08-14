// Topping-cap exemptions.
//
// House rule: three toppings on a drink, in total, and Oreo is free.
//
// It used to be three DIFFERENT toppings with three of each — up to nine on a
// cup, which is not what "up to 3" reads as. Stan flattened it to a total of
// three (2026-08-14). Three of one kind is fine; the total is what is capped.
//
// Oreo is exempt: any quantity, and it never counts toward the three.
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
//
// TOPPING no longer uses maxDistinct, but other lists may, and the helper is
// still the right shape for them.
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

// Total that drives the maxTotal cap: every picked modifier's QUANTITY summed,
// excluding uncounted toppings (Oreo). Two pearls and a jelly is three.
//
// The difference from a plain sum is the whole rule: counting Oreo here would
// silently turn "three toppings plus free Oreo" into "three including Oreo",
// which is a smaller drink for the same money and nobody's stated intent.
export function cappedTotalCount(
  modifiers: { id: string; name: string }[],
  counts: Record<string, number>,
): number {
  let n = 0;
  for (const mod of modifiers) {
    if (isUncountedTopping(mod.name)) continue;
    n += counts[mod.id] ?? 0;
  }
  return n;
}
