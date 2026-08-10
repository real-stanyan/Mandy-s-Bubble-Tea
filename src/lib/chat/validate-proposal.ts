import type { MenuCategory, MenuItem, Menu } from "@/lib/catalog";
import { getItemDetail } from "@/lib/catalog";
import { cappedDistinctCount, isUncountedTopping } from "@/lib/menu/topping-rules";
import {
  displayNameFor,
  lockedModifierIds,
  lockedToppingsFor,
} from "@/lib/menu/top10-presets";
import {
  buildCartLine,
  unitPriceCentsFor,
  type CountMap,
} from "@/lib/menu/build-cart-line";
import {
  isExclusiveModifier,
  isWarmIceModifier,
  someSelectedAcrossLists,
} from "@/lib/menu/modifier-mutex";
import type { CartLine } from "@/store/cart";

/** Exactly the shape of the model's propose_drink tool call. */
export type DrinkProposal = {
  itemId: string;
  variationId: string;
  modifiers: { modifierId: string; count: number }[];
  quantity: number;
  reason: string;
};

export type ValidatedProposal = {
  line: Omit<CartLine, "id" | "quantity">;
  quantity: number;
  unitPriceCents: bigint;
  totalCents: bigint;
  categorySlug: string;
  reason: string;
};

export type ValidationResult =
  | { ok: true; value: ValidatedProposal }
  | { ok: false; errors: string[] };

/** Upper bound on a single proposal. A model that miscounts "a few" should
 *  hit a wall long before it puts 9999 cups in someone's cart. */
const MAX_QUANTITY = 20;

/** First category listing this item, plus the item as that category renders
 *  it. getItemDetail() is category-scoped — TOP 10 applies locked toppings
 *  and a preset display name that MILKY does not — so the slug is part of
 *  the answer, not an incidental lookup key. */
function locateItem(
  menu: Menu,
  itemId: string,
): { category: MenuCategory; item: MenuItem } | null {
  for (const category of menu.categories) {
    const items = menu.itemsBySlug.get(category.slug) ?? [];
    const item = items.find((i) => i.id === itemId);
    if (item) return { category, item };
  }
  const loose = menu.uncategorizedItems.find((i) => i.id === itemId);
  if (loose) {
    return {
      category: { id: "", squareName: "", slug: "", imageUrl: null, itemCount: 0 },
      item: loose,
    };
  }
  return null;
}

/**
 * Check a model-authored proposal against the real catalog.
 *
 * Every id is verified to exist and to belong where the model claimed it
 * did; every selection bound the menu UI enforces is enforced again here.
 * The model is never trusted for a price — the returned amounts are
 * recomputed from catalog data via the same helper the menu page uses.
 *
 * Errors accumulate rather than short-circuit: the caller feeds the whole
 * list back to the model, and one retry that fixes three mistakes beats
 * three retries that fix one each.
 */
export function validateProposal(
  menu: Menu,
  proposal: DrinkProposal,
): ValidationResult {
  const errors: string[] = [];

  if (!Number.isInteger(proposal.quantity) || proposal.quantity < 1) {
    errors.push(`quantity must be a whole number of at least 1, got ${proposal.quantity}`);
  } else if (proposal.quantity > MAX_QUANTITY) {
    errors.push(`quantity ${proposal.quantity} exceeds the ${MAX_QUANTITY}-cup limit per proposal`);
  }

  const located = locateItem(menu, proposal.itemId);
  if (!located) {
    errors.push(`itemId ${proposal.itemId} is not on the menu`);
    return { ok: false, errors };
  }
  const { category, item } = located;
  if (item.soldOut) {
    errors.push(`${item.name} is sold out today`);
  }

  const detail = getItemDetail(menu, category.slug, item.id);
  if (!detail) {
    errors.push(`itemId ${proposal.itemId} could not be resolved under ${category.slug}`);
    return { ok: false, errors };
  }

  const variation = item.variations.find((v) => v.id === proposal.variationId);
  if (!variation) {
    errors.push(`variationId ${proposal.variationId} does not belong to ${item.name}`);
  } else if (variation.soldOut) {
    errors.push(`${item.name} in size ${variation.name} is sold out today`);
  }

  // Fold the flat modifier list into per-list counts, rejecting ids that
  // don't belong to this item along the way.
  const counts: CountMap = {};
  for (const { modifierId, count } of proposal.modifiers) {
    if (!Number.isInteger(count) || count < 1) {
      errors.push(`modifier ${modifierId} has an invalid count ${count}`);
      continue;
    }
    const owner = detail.modifierLists.find((ml) =>
      ml.modifiers.some((m) => m.id === modifierId),
    );
    if (!owner) {
      errors.push(`modifierId ${modifierId} is not available on ${item.name}`);
      continue;
    }
    const mod = owner.modifiers.find((m) => m.id === modifierId)!;
    if (mod.soldOut) {
      errors.push(`${mod.name} is sold out today`);
      continue;
    }
    const map = counts[owner.id] ?? {};
    map[modifierId] = (map[modifierId] ?? 0) + count;
    counts[owner.id] = map;
  }

  // TOP 10 presets lock toppings on. The customer can't remove them in the
  // menu UI, so the chatbox must not be able to either — seed them before
  // the bounds check so a locked topping can't trip maxDistinct silently.
  // Reuses lockedModifierIds() rather than matching names here: the menu
  // path already goes through it, and a second name-normalizing rule would
  // be a second thing to keep in sync.
  //
  // A locked topping that's sold out cannot be silently seeded — the menu
  // UI's soldOutSelectedNames disables Add to Cart in exactly this case
  // (ItemOrderForm.tsx), so accepting the proposal here would let the chat
  // path checkout a drink the shop can't actually make.
  const lockedToppings = lockedToppingsFor(category.slug, item.name);
  for (const { listId, modifierId } of lockedModifierIds(
    detail.modifierLists,
    lockedToppings,
  )) {
    const list = detail.modifierLists.find((ml) => ml.id === listId);
    const lockedMod = list?.modifiers.find((m) => m.id === modifierId);
    if (lockedMod?.soldOut) {
      errors.push(
        `${lockedMod.name} is sold out today, so ${item.name} can't be made as configured`,
      );
      continue;
    }
    const map = counts[listId] ?? {};
    if ((map[modifierId] ?? 0) < 1) map[modifierId] = 1;
    counts[listId] = map;
  }

  // Cross-list mutex: Warm ice ⊥ Cheese Cream / Brulee toppings — hot
  // drinks don't pair with cold cream or torched sugar. Mirrors
  // canIncrement() in ItemOrderForm.tsx via the shared modifier-mutex.ts
  // helpers, so the chatbox can't compose a combination the shop can't
  // make even though nothing on the id/bounds side objects to it.
  if (
    someSelectedAcrossLists(counts, detail.modifierLists, isWarmIceModifier) &&
    someSelectedAcrossLists(counts, detail.modifierLists, isExclusiveModifier)
  ) {
    errors.push(
      "Warm ice cannot be combined with Cheese Cream or Brulee toppings",
    );
  }

  // Within-list mutex: Cheese Cream and Brulee are exclusive partners —
  // each stackable on its own, but not together. Mirrors
  // getExclusivePartner() in ItemOrderForm.tsx.
  for (const ml of detail.modifierLists) {
    const map = counts[ml.id];
    if (!map) continue;
    const selectedExclusive = ml.modifiers.filter(
      (m) => (map[m.id] ?? 0) > 0 && isExclusiveModifier(m),
    );
    if (selectedExclusive.length > 1) {
      errors.push(
        `${selectedExclusive.map((m) => m.name).join(" and ")} cannot both be selected`,
      );
    }
  }

  // Same bounds the menu UI enforces, re-checked here because nothing
  // stopped the model from ignoring them.
  for (const ml of detail.modifierLists) {
    const map = counts[ml.id] ?? {};
    const picked = Object.values(map).reduce((a, b) => a + b, 0);
    const distinct = cappedDistinctCount(ml.modifiers, map);

    if (picked < ml.minSelected) {
      errors.push(
        `${ml.name} needs at least ${ml.minSelected} selection, got ${picked}`,
      );
    }
    if (ml.maxSelected != null && picked > ml.maxSelected) {
      errors.push(`${ml.name} allows at most ${ml.maxSelected}, got ${picked}`);
    }
    if (ml.maxDistinct != null && distinct > ml.maxDistinct) {
      errors.push(
        `${ml.name} allows at most ${ml.maxDistinct} different options, got ${distinct}`,
      );
    }
    if (ml.maxPerKind != null) {
      for (const [modId, n] of Object.entries(map)) {
        const modInfo = ml.modifiers.find((m) => m.id === modId);
        // Oreo (and any other uncounted topping) is exempt from maxPerKind,
        // same as canIncrement() in ItemOrderForm.tsx — it's unlimited.
        if (modInfo && isUncountedTopping(modInfo.name)) continue;
        if (n <= ml.maxPerKind) continue;
        const name = modInfo?.name ?? modId;
        errors.push(`${name} allows at most ${ml.maxPerKind}, got ${n}`);
      }
    }
  }

  if (errors.length > 0 || !variation) {
    return { ok: false, errors };
  }

  const line = buildCartLine({
    item,
    displayName: displayNameFor(category.slug, item.name),
    variation,
    modifierLists: detail.modifierLists,
    counts,
  });
  const unitPriceCents = unitPriceCentsFor(variation, detail.modifierLists, counts);

  return {
    ok: true,
    value: {
      line,
      quantity: proposal.quantity,
      unitPriceCents,
      totalCents: unitPriceCents * BigInt(proposal.quantity),
      categorySlug: category.slug,
      reason: proposal.reason,
    },
  };
}
