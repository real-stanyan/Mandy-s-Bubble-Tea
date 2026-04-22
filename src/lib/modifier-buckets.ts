// src/lib/modifier-buckets.ts

// Maps Square modifier list ids to our logical buckets. Used at webhook
// time to sort a line item's modifiers into topping/ice/sugar slots for
// the sticker. Unknown modifier lists fall through to the topping bucket
// (safe default: shows up on the sticker rather than being dropped).
//
// To add a new modifier list (e.g. "Seasonal Flavour"):
//   1. Find its id in Square Dashboard (Items & orders -> Modifiers).
//   2. Decide which bucket it belongs to.
//   3. Add an entry below.

export type ModifierBucket = "topping" | "ice" | "sugar";

export const MODIFIER_LIST_BUCKETS: Record<string, ModifierBucket> = {
  // TODO(pre-launch): replace these ids with the real ones from Square Dashboard.
  "REPLACE_ME_TOPPING_LIST_ID": "topping",
  "REPLACE_ME_ICE_LEVEL_LIST_ID": "ice",
  "REPLACE_ME_SUGAR_LEVEL_LIST_ID": "sugar",
};

export function bucketForModifierList(modifierListId: string | undefined | null): ModifierBucket {
  if (!modifierListId) return "topping";
  return MODIFIER_LIST_BUCKETS[modifierListId] ?? "topping";
}
