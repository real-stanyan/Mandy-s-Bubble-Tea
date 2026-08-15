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

/** Levenshtein, for the near-miss pass. */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const row = [i, ...new Array<number>(cols - 1).fill(0)];
    for (let j = 1; j < cols; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[cols - 1];
}

/**
 * How wrong a heard name may be and still count.
 *
 * One edit, and only for names of five characters or more. That is not a
 * guess: across the whole list, no two names of five characters or more are
 * closer than three edits apart (the nearest pair is "mango" and "orange").
 * At distance three, a word within one edit of a name cannot also be within
 * one edit of another — if it were, those two names would be within two of
 * each other. So this pass can be wrong about whether it heard a name, and
 * cannot be wrong about which one.
 *
 * The short names are excluded because they are the dangerous ones: PF, PA,
 * GF and GA are mutually one edit apart, and LYMT is two from LIME. A single
 * mis-heard letter there would swap passion fruit for pineapple silently.
 * They still match exactly, which is how the labels are read anyway.
 *
 * name-collisions.test.ts fails if a future item breaks this.
 */
const FUZZY_MIN_LENGTH = 5;
const FUZZY_MAX_EDITS = 1;

type NameHit = { name: string; items: StockItem[] };

function fuzzyFind(phrase: string, names: NameHit[]): NameHit | null {
  if (phrase.length < FUZZY_MIN_LENGTH) return null;
  let best: NameHit | null = null;
  let bestDistance = Infinity;
  let tied = false;
  for (const candidate of names) {
    if (candidate.name.length < FUZZY_MIN_LENGTH) continue;
    // Length alone rules most of the list out before the expensive part.
    if (Math.abs(candidate.name.length - phrase.length) > FUZZY_MAX_EDITS) continue;
    const d = editDistance(phrase, candidate.name);
    if (d > FUZZY_MAX_EDITS) continue;
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
      tied = false;
    } else if (d === bestDistance) {
      tied = true;
    }
  }
  // A tie should be impossible given the distances in the list, but if the
  // list ever changes, refusing is the failure this file is built around.
  return tied ? null : best;
}

export function parseVoiceCounts(transcript: string): VoiceParse {
  const text = normalise(transcript);
  const names = searchOrder();
  const longestName = names.reduce((n, x) => Math.max(n, x.name.split(" ").length), 1);

  // Words with their offsets, so a match can be located back in the text and
  // the gap to the next match read off as that item's answer.
  const words: Array<{ word: string; start: number; end: number }> = [];
  const wordPattern = /[a-z0-9.]+/g;
  let m: RegExpExecArray | null;
  while ((m = wordPattern.exec(text)) !== null) {
    words.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  }

  // Pass one: where the item names are. Longest phrase wins, so "tiger brown
  // sugar" beats "brown sugar", and exact always beats near-miss.
  const hits: Array<{ hit: NameHit; from: number; to: number; fuzzy: boolean }> = [];
  for (let w = 0; w < words.length; ) {
    let found: { hit: NameHit; span: number; fuzzy: boolean } | null = null;
    for (let n = Math.min(longestName, words.length - w); n >= 1 && !found; n--) {
      const phrase = words
        .slice(w, w + n)
        .map((x) => x.word)
        .join(" ");
      const exact = names.find((x) => x.name === phrase);
      if (exact) found = { hit: exact, span: n, fuzzy: false };
    }
    if (!found) {
      for (let n = Math.min(longestName, words.length - w); n >= 1 && !found; n--) {
        const phrase = words
          .slice(w, w + n)
          .map((x) => x.word)
          .join(" ");
        const near = fuzzyFind(phrase, names);
        if (near) found = { hit: near, span: n, fuzzy: true };
      }
    }
    if (!found) {
      w += 1;
      continue;
    }
    hits.push({
      hit: found.hit,
      from: words[w].start,
      to: words[w + found.span - 1].end,
      fuzzy: found.fuzzy,
    });
    w += found.span;
  }

  // Pass two: everything between one name and the next is that name's answer.
  const matched: VoiceMatch[] = [];
  const ambiguous: string[] = [];
  const missingValue: string[] = [];
  const taken = new Set<string>();

  for (let h = 0; h < hits.length; h++) {
    const { hit, from, to } = hits[h];
    const window = text.slice(to, hits[h + 1]?.from ?? text.length);

    let item: StockItem | null = null;
    if (hit.items.length === 1) {
      item = hit.items[0];
    } else {
      // Two items share this name — the Lemons, the Oranges. A category word
      // on either side decides it; without one this is left for a human,
      // because guessing writes a number against the wrong bottle.
      const before = text.slice(Math.max(0, from - 24), from);
      const category = [...CATEGORY_WORDS.entries()].find(
        ([word]) => before.includes(word) || window.includes(word),
      );
      item = category
        ? (hit.items.find((it) => CATEGORY_OF.get(it.id) === category[1]) ?? null)
        : null;
      if (!item) {
        if (!ambiguous.includes(hit.name)) ambiguous.push(hit.name);
        continue;
      }
    }

    if (taken.has(item.id)) continue;

    const value = valueIn(window, item);
    if (value === null) {
      if (!missingValue.includes(item.name)) missingValue.push(item.name);
    } else {
      taken.add(item.id);
      matched.push({ item, value, heard: `${text.slice(from, to)}${window}`.trim() });
    }
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
