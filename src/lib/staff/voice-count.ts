import { ALL_ITEMS, STOCK_LIST, type StockItem } from "./stocklist";

// Turning "mango three peach five lychee two" into counts.
//
// No model does this. The vocabulary is closed — sixty-eight known items, the
// numbers, and three words for "enough" — so it is a lookup, and a lookup can
// be tested and cannot invent anything. That last part is the whole argument:
// this data is what the shop orders from. A parser that finds nothing leaves
// the field blank for a human, which is safe. A model that guesses between
// Brûlée Powder and Pudding Powder writes a confident wrong number into an
// order, which is not.
//
// Nothing here submits anything either. It fills the form; a person still
// looks at it and presses the button.

export type VoiceMatch = {
  item: StockItem;
  /** Exactly what goes in the field: a number as typed, or a sufficiency key. */
  value: string;
  /** The words this came from, so the screen can show its working. */
  heard: string;
};

export type VoiceParse = {
  matched: VoiceMatch[];
  /** Names that matched more than one item, e.g. the two Lemons. */
  ambiguous: string[];
  /** Item names heard with no number after them. */
  missingValue: string[];
};

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20,
  // Recognisers hand these back for "0" and "1" more often than the digits.
  none: 0, nil: 0, oh: 0,
};

/** Spoken answers for the enough/maybe/short items. Deliberately generous on
 *  the two ends and narrow in the middle: "maybe" has to be said on purpose. */
const SUFFICIENCY_WORDS: Array<[RegExp, string]> = [
  [/\b(not enough|run out|ran out|out|empty|none left|finished|no more)\b/, "short"],
  [/\b(maybe|might|not sure|borderline|just enough|barely)\b/, "maybe"],
  [/\b(enough|plenty|fine|good|ok|okay|lots|full)\b/, "enough"],
];

/**
 * What the shelf labels abbreviate, because nobody says "P F" out loud.
 *
 * These are the only names in the list that cannot be read off the bottle and
 * spoken: Rick supplied them. The letters still work — a recogniser hands back
 * "p f" often enough — but "passion fruit" is what anyone actually says.
 *
 * Every one of these came from Rick rather than from guessing. GF looks like
 * it could be a dozen things; it is grapefruit because he said so.
 */
const ALIASES: Array<[string, string]> = [
  ["passion fruit", "syrup-pf"],
  ["passionfruit", "syrup-pf"],
  ["green apple", "syrup-ga"],
  ["grapefruit", "syrup-gf"],
  ["grape fruit", "syrup-gf"],
  ["pineapple", "syrup-pa"],
  ["pine apple", "syrup-pa"],
  ["lychee milk tea", "syrup-lymt"],
];

/** Which category a word names, for disambiguating the two Lemons. */
const CATEGORY_WORDS = new Map(
  STOCK_LIST.map((c) => [c.name.toLowerCase(), c.id] as const),
);

/** Which category each item is actually in.
 *
 *  Looked up rather than derived from the id: the Others category has id
 *  "others" while its items are "other-lemon", so a prefix test silently never
 *  matched and "others lemon one" stayed ambiguous forever. Found by reading
 *  the parser's output on a realistic sentence, not by the type checker. */
const CATEGORY_OF = new Map(
  STOCK_LIST.flatMap((c) => c.items.map((i) => [i.id, c.id] as const)),
);

function normalise(text: string): string {
  return (
    text
      .toLowerCase()
      // "Brûlée" comes back from the recogniser unaccented.
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      // Single letters spoken apart — "p f" for PF, "l y m t" for LYMT. Only
      // runs of 2+ isolated letters collapse, so "a lot" is left alone.
      .replace(/\b([a-z])(?:[ .]+([a-z])\b){1,}/g, (m) => m.replace(/[ .]/g, ""))
      .replace(/[,;]/g, " , ")
      .replace(/\band\b/g, " , ")
      .replace(/[^a-z0-9., ]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Item names longest first, so "tiger brown sugar" wins over "brown sugar". */
function searchOrder(): Array<{ name: string; items: StockItem[] }> {
  const byName = new Map<string, StockItem[]>();
  for (const item of ALL_ITEMS) {
    const key = normalise(item.name);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), item]);
  }
  for (const [spoken, id] of ALIASES) {
    const item = ALL_ITEMS.find((i) => i.id === id);
    // A typo in the table would otherwise become a name that matches nothing
    // and fails silently, which is the failure mode this whole file avoids.
    if (!item) throw new Error(`voice-count: alias "${spoken}" points at unknown item ${id}`);
    byName.set(normalise(spoken), [item]);
  }
  return [...byName.entries()]
    .map(([name, items]) => ({ name, items }))
    .sort((a, b) => b.name.length - a.name.length);
}

/** A number written as digits or as a word, at the start of `text`. */
function leadingValue(text: string): { value: string; length: number } | null {
  const digits = text.match(/^(\d+(?:\.\d+)?)/);
  if (digits) return withFraction(text, digits[1], digits[1].length);
  const word = text.match(/^([a-z]+)/);
  if (word && word[1] in NUMBER_WORDS) {
    return withFraction(text, String(NUMBER_WORDS[word[1]]), word[1].length);
  }
  return null;
}

/**
 * "three point five" is 3.5, not 3.
 *
 * Half a bottle is a real answer — the keypad has a decimal point for exactly
 * this — and dropping the fraction silently turned it into a different number.
 * Wrong quietly is the failure this file exists to avoid.
 */
function withFraction(
  text: string,
  whole: string,
  length: number,
): { value: string; length: number } {
  const tail = text.slice(length).match(/^\s*(?:point|\.)\s*([a-z]+|\d)/);
  if (!tail) return { value: whole, length };
  const spoken = tail[1];
  const fraction = /^\d$/.test(spoken)
    ? Number(spoken)
    : spoken in NUMBER_WORDS
      ? NUMBER_WORDS[spoken]
      : null;
  if (fraction === null || fraction > 9) return { value: whole, length };
  return { value: `${whole}.${fraction}`, length: length + tail[0].length };
}

export function parseVoiceCounts(transcript: string): VoiceParse {
  const text = normalise(transcript);
  const names = searchOrder();
  const matched: VoiceMatch[] = [];
  const ambiguous: string[] = [];
  const missingValue: string[] = [];
  const taken = new Set<string>();

  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const hit = names.find(
      (n) =>
        rest.startsWith(n.name) &&
        // Whole words only: "pa" must not match inside "papaya".
        !/[a-z0-9]/.test(rest.charAt(n.name.length)),
    );
    if (!hit) {
      i += 1;
      continue;
    }

    // Everything up to the next item name is this item's answer.
    const after = rest.slice(hit.name.length);
    const nextName = names
      .map((n) => {
        const at = after.indexOf(n.name);
        return at === -1 ? Infinity : at;
      })
      .reduce((a, b) => Math.min(a, b), Infinity);
    const window = after.slice(0, Number.isFinite(nextName) ? nextName : undefined);

    let item: StockItem | null = null;
    if (hit.items.length === 1) {
      item = hit.items[0];
    } else {
      // Two items share this name — the Lemons, the Oranges. A category word
      // on either side decides it; without one this is left for a human,
      // because guessing writes a number against the wrong bottle.
      const before = text.slice(Math.max(0, i - 24), i);
      const category = [...CATEGORY_WORDS.entries()].find(
        ([word]) => before.includes(word) || window.includes(word),
      );
      item = category
        ? (hit.items.find((it) => CATEGORY_OF.get(it.id) === category[1]) ?? null)
        : null;
      if (!item) {
        if (!ambiguous.includes(hit.name)) ambiguous.push(hit.name);
        i += hit.name.length;
        continue;
      }
    }

    if (taken.has(item.id)) {
      i += hit.name.length;
      continue;
    }

    const value = valueIn(window, item);
    if (value === null) {
      if (!missingValue.includes(item.name)) missingValue.push(item.name);
    } else {
      taken.add(item.id);
      matched.push({ item, value, heard: `${hit.name}${window}`.trim() });
    }
    i += hit.name.length;
  }

  return { matched, ambiguous, missingValue };
}

/** The answer inside one item's window, in the form its field expects. */
function valueIn(window: string, item: StockItem): string | null {
  if (item.rule.kind === "sufficiency") {
    for (const [pattern, key] of SUFFICIENCY_WORDS) {
      if (pattern.test(window)) return key;
    }
    // A bare number against a sufficiency item still says something useful:
    // nobody says "zero" when they mean "plenty".
    const n = firstNumber(window);
    if (n !== null) return Number(n) === 0 ? "short" : "enough";
    return null;
  }
  return firstNumber(window);
}

function firstNumber(window: string): string | null {
  for (let i = 0; i < window.length; i++) {
    if (!/[a-z0-9]/.test(window.charAt(i))) continue;
    if (i > 0 && /[a-z0-9]/.test(window.charAt(i - 1))) continue;
    const found = leadingValue(window.slice(i));
    if (found) return found.value;
  }
  return null;
}
