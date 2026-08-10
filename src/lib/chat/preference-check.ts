import type { ModifierList } from "@/lib/catalog";

/**
 * A customer preference the catalog may or may not be able to honour.
 *
 * The failure this exists to stop: the customer asks for something the
 * drink has no option for ("Taro Milk Tea 不要糖" — that item's SUGAR
 * LEVEL list is Standard/Extra only), the model answers "sure, no sugar"
 * and proposes the drink anyway, and the card silently carries the
 * default. The prose promised one drink, the kitchen makes another.
 *
 * The system prompt already asks the model not to do this. This is the
 * gate behind the request: a deterministic check the model cannot talk
 * its way past.
 */
export type PreferenceRule = {
  key: string;
  /** How a customer phrases the request, zh + en. */
  asks: RegExp;
  /** Which modifier list would have to carry it. */
  list: RegExp;
  /** An option that would actually satisfy it. */
  satisfies: RegExp;
  /** What the model is told when the catalog can't do it. */
  explain: string;
};

export const PREFERENCE_RULES: PreferenceRule[] = [
  {
    key: "no-sugar",
    asks: /不要糖|不加糖|无糖|無糖|零糖|去糖|sugar[-\s]?free|no sugar|without sugar|zero sugar/i,
    list: /sugar/i,
    satisfies: /no sugar|0\s*%|zero|sugar[-\s]?free|unsweet/i,
    explain: "has no sugar-free option",
  },
  {
    key: "less-sugar",
    asks: /少糖|半糖|微糖|三分糖|五分糖|七分糖|少甜|less sugar|half sugar|low sugar|light sugar/i,
    list: /sugar/i,
    satisfies: /less|half|light|low|[1-7]0\s*%|75\s*%|25\s*%|no sugar|0\s*%/i,
    explain: "has no reduced-sugar option",
  },
  {
    key: "no-ice",
    asks: /去冰|不要冰|不加冰|无冰|無冰|no ice|without ice/i,
    list: /ice/i,
    satisfies: /no ice|without ice|warm|hot/i,
    explain: "has no no-ice option",
  },
  {
    key: "less-ice",
    asks: /少冰|微冰|less ice|light ice/i,
    list: /ice/i,
    satisfies: /less ice|light ice|no ice/i,
    explain: "has no less-ice option",
  },
  {
    key: "hot",
    asks: /热的|熱的|要热|要熱|温的|溫的|hot drink|make it hot|serve.*warm/i,
    list: /ice/i,
    satisfies: /warm|hot/i,
    explain: "cannot be made warm",
  },
  {
    key: "cheese-foam",
    asks: /奶盖|奶蓋|芝士奶盖|cheese foam|cheese cream|cheese top/i,
    list: /topping|cream/i,
    satisfies: /cheese/i,
    explain: "has no cheese cream option",
  },
];

/**
 * Preferences the customer asked for that this drink physically cannot
 * honour. Empty means every request is at least *possible* — whether the
 * model actually selected the right option is validate-proposal's job.
 *
 * Matching is deliberately literal: a rule fires only when the customer's
 * own words match AND no option in the corresponding list could satisfy
 * them. A drink with no SUGAR list at all fails the same way as one whose
 * SUGAR list stops at "Standard" — from the customer's side those are the
 * same disappointment.
 */
export function unsupportedPreferences(
  customerText: string,
  modifierLists: ModifierList[],
  itemName: string,
): string[] {
  const out: string[] = [];
  for (const rule of PREFERENCE_RULES) {
    if (!rule.asks.test(customerText)) continue;
    const lists = modifierLists.filter((ml) => rule.list.test(ml.name ?? ""));
    const canDo = lists.some((ml) =>
      ml.modifiers.some((m) => !m.soldOut && rule.satisfies.test(m.name)),
    );
    if (canDo) continue;
    const available = lists
      .flatMap((ml) => ml.modifiers.filter((m) => !m.soldOut).map((m) => m.name))
      .join(", ");
    out.push(
      `${itemName} ${rule.explain} — the customer asked for it and the catalog cannot do it. ` +
        (available
          ? `The only options are: ${available}. `
          : `That drink has no such list at all. `) +
        `Do NOT propose this drink as if the request were honoured: tell the customer plainly what is and isn't possible, and offer the closest option or a different drink.`,
    );
  }
  return out;
}
