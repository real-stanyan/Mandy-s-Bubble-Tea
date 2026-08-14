import type { Menu, MenuItem, ModifierList } from "@/lib/catalog";

const sugarList: ModifierList = {
  id: "ML_SUGAR",
  name: "SUGAR",
  minSelected: 1,
  maxSelected: 1,
  maxDistinct: null,
  maxPerKind: 1,
  modifiers: [
    { id: "MOD_SUGAR_100", name: "100%", priceCents: null, ordinal: 0, onByDefault: true, soldOut: false },
    { id: "MOD_SUGAR_50", name: "50%", priceCents: null, ordinal: 1, onByDefault: false, soldOut: false },
    { id: "MOD_SUGAR_0", name: "0%", priceCents: null, ordinal: 2, onByDefault: false, soldOut: false },
  ],
};

const iceList: ModifierList = {
  id: "ML_ICE",
  name: "ICE",
  minSelected: 1,
  maxSelected: 1,
  maxDistinct: null,
  maxPerKind: 1,
  modifiers: [
    { id: "MOD_ICE_REG", name: "Regular Ice", priceCents: null, ordinal: 0, onByDefault: true, soldOut: false },
    { id: "MOD_ICE_NONE", name: "No Ice", priceCents: null, ordinal: 1, onByDefault: false, soldOut: false },
    // Matches isWarmIceModifier() in modifier-mutex.ts (name === "warm",
    // case/whitespace-insensitive) — needed to exercise the warm-ice /
    // cheese-cream cross-list mutex in validate-proposal.test.ts.
    { id: "MOD_ICE_WARM", name: "Warm", priceCents: null, ordinal: 2, onByDefault: false, soldOut: false },
  ],
};

// Matches EXCLUSIVE_TOPPINGS in modifier-mutex.ts ("Cheese Cream" /
// "Brulee") — needed to exercise the Cheese-Cream/Brulee exclusivity rule
// and the warm-ice cross-list mutex in validate-proposal.test.ts. Added
// additively as its own list/ref: no existing id, name, or price changes.
const creamList: ModifierList = {
  id: "ML_CREAM",
  name: "CREAM",
  minSelected: 0,
  maxSelected: null,
  maxDistinct: null,
  maxPerKind: null,
  modifiers: [
    { id: "MOD_CHEESE_CREAM", name: "Cheese Cream", priceCents: 100n, ordinal: 0, onByDefault: false, soldOut: false },
    { id: "MOD_BRULEE", name: "Brulee", priceCents: 100n, ordinal: 1, onByDefault: false, soldOut: false },
  ],
};

// Mirrors what getItemDetail() builds for a real TOPPING list: a flat total
// of three, Oreo exempt. Left on the old maxDistinct/maxPerKind pair, the
// chat tests would keep proving the validator enforces a rule the shop no
// longer has.
const toppingList: ModifierList = {
  id: "ML_TOPPING",
  name: "TOPPING",
  minSelected: 0,
  maxSelected: null,
  maxDistinct: null,
  maxPerKind: null,
  maxTotal: 3,
  modifiers: [
    { id: "MOD_PEARL", name: "Pearl", priceCents: 80n, ordinal: 0, onByDefault: false, soldOut: false },
    { id: "MOD_JELLY", name: "Grass Jelly", priceCents: 80n, ordinal: 1, onByDefault: false, soldOut: false },
    { id: "MOD_PUDDING", name: "Pudding", priceCents: 80n, ordinal: 2, onByDefault: false, soldOut: false },
    { id: "MOD_REDBEAN", name: "Red Bean", priceCents: 80n, ordinal: 3, onByDefault: false, soldOut: false },
    { id: "MOD_OREO", name: "Oreo", priceCents: 100n, ordinal: 4, onByDefault: false, soldOut: false },
    { id: "MOD_SOLDOUT", name: "Taro Ball", priceCents: 80n, ordinal: 5, onByDefault: false, soldOut: true },
  ],
};

// Production's Taro Milk Tea ships SUGAR LEVEL as Standard/Extra only —
// there is no reduced-sugar option at all (probed 2026-08-11). That shape
// is what let the model promise a customer '不要糖' and send a card
// carrying the default; preference-check.ts exists to stop it, and this
// list is what proves it end to end.
const fixedSugarList: ModifierList = {
  id: 'ML_SUGAR_FIXED',
  name: 'SUGAR LEVEL',
  minSelected: 0,
  maxSelected: 1,
  maxDistinct: null,
  maxPerKind: 1,
  modifiers: [
    { id: 'MOD_SUGAR_STD', name: 'Standard Sugar', priceCents: null, ordinal: 0, onByDefault: true, soldOut: false },
    { id: 'MOD_SUGAR_EXTRA', name: 'Extra Sugar', priceCents: null, ordinal: 1, onByDefault: false, soldOut: false },
  ],
};

const refs = [
  { id: "ML_SUGAR", minOverride: null, maxOverride: null, modifierOverrides: [] },
  { id: "ML_ICE", minOverride: null, maxOverride: null, modifierOverrides: [] },
  { id: "ML_TOPPING", minOverride: null, maxOverride: null, modifierOverrides: [] },
  { id: "ML_CREAM", minOverride: null, maxOverride: null, modifierOverrides: [] },
];

function item(
  id: string,
  name: string,
  categoryIds: string[],
  opts: { soldOut?: boolean; refs?: typeof refs } = {},
): MenuItem {
  return {
    id,
    name,
    description: null,
    imageUrl: `https://example.test/${id}.png`,
    priceCents: 750n,
    variationLabel: "Regular",
    variations: [
      { id: `${id}_REG`, name: "Regular", priceCents: 750n, soldOut: false },
      { id: `${id}_LRG`, name: "Large", priceCents: 850n, soldOut: opts.soldOut ?? false },
    ],
    modifierListRefs: opts.refs ?? refs,
    categoryIds,
    soldOut: opts.soldOut ?? false,
  };
}

const taro = item("ITEM_TARO", "Taro Milk Tea", ["CAT_MILKY"]);
const brownSugar = item("ITEM_BROWN", "Brown Sugar Milk Tea", ["CAT_MILKY"]);
const mango = item("ITEM_MANGO", "Mango Green Tea", ["CAT_FRUITY"]);
const soldOutItem = item("ITEM_GONE", "Winter Melon Tea", ["CAT_FRUITY"], { soldOut: true });

// A TOP 10-only listing. The preset table in top10-presets.ts is keyed by
// item NAME, and "taro milk tea" really does map to lockedToppings
// ["Pudding"] + displayName "Taro Milk Tea (with Pudding)" — which is why
// the fixture's TOPPING list carries a modifier named exactly "Pudding".
// It gets its own id so the milky-category tests above stay unaffected:
// locateItem() scans categories in order and would otherwise resolve
// ITEM_TARO to milky, leaving the locked-topping path untested.
const fixedSweet = item('ITEM_FIXED_SWEET', 'Fixed Sweet Milk Tea', ['CAT_MILKY'], {
  refs: refs.map((r) => (r.id === 'ML_SUGAR' ? { ...r, id: 'ML_SUGAR_FIXED' } : r)),
});
const top10Taro = item("ITEM_TOP10_TARO", "Taro Milk Tea", ["CAT_TOP10"]);

export function fixtureMenu(): Menu {
  return {
    categories: [
      { id: "CAT_MILKY", squareName: "MILKY", slug: "milky", imageUrl: null, itemCount: 2 },
      { id: "CAT_FRUITY", squareName: "FRUITY", slug: "fruity", imageUrl: null, itemCount: 2 },
      { id: "CAT_TOP10", squareName: "TOP 10", slug: "top-10", imageUrl: null, itemCount: 1 },
    ],
    itemsBySlug: new Map([
      ["milky", [taro, brownSugar, fixedSweet]],
      ["fruity", [mango, soldOutItem]],
      ["top-10", [top10Taro]],
    ]),
    uncategorizedItems: [],
    modifierLists: new Map([
      ["ML_SUGAR", sugarList],
      ["ML_SUGAR_FIXED", fixedSugarList],
      ["ML_ICE", iceList],
      ["ML_TOPPING", toppingList],
      ["ML_CREAM", creamList],
    ]),
  };
}
