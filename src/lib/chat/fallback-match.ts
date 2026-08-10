import type { Menu } from "@/lib/catalog";

export type MenuSuggestion = {
  itemId: string;
  itemName: string;
  categorySlug: string;
};

/** Words too common to carry signal in a bubble tea shop. */
const STOP_WORDS = new Set([
  "a", "an", "the", "i", "want", "would", "like", "please", "me", "get",
  "one", "some", "with", "and", "or",
]);

/** CJK Unified Ideographs (+ Extension A) are treated as word characters,
 *  not separators. Without this, every Chinese query — the shop's majority
 *  language — tokenizes to an empty array and fallbackMatch() returns []
 *  indistinguishably from a genuine no-match, even before considering
 *  whether anything actually matched. The menu's item names are in
 *  English, so exact CJK-to-name matching will rarely hit; that's expected
 *  — the point is that a Chinese query produces real tokens to search
 *  with, not that it's guaranteed to find something.
 *
 *  Making CJK a word character removes the separator that used to fall
 *  between it and adjacent Latin text, and Chinese input normally has no
 *  space before a Latin word ("来杯mango", "有taro吗") — so without an
 *  explicit script-boundary split, the whole unspaced run collapses into
 *  one unmatchable token ("来杯mango") instead of yielding "mango". The
 *  replace() below inserts a boundary at every CJK <-> Latin/digit
 *  transition before the normal separator split runs, so a script change
 *  counts as a word break even with no space. Do not remove this "to
 *  simplify" — it is exactly what makes "来杯mango" recover "mango". */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(?<=[一-鿿㐀-䶿])(?=[a-z0-9])|(?<=[a-z0-9])(?=[一-鿿㐀-䶿])/g, " ")
    .split(/[^a-z0-9一-鿿㐀-䶿]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * Keyword fallback for when the model is unreachable, too slow, or has
 * failed validation twice.
 *
 * Deliberately dumb: it scores items by how many query words appear in the
 * item name and returns the best few. It cannot handle "something not too
 * sweet" — that's the model's job. Its only purpose is that the chatbox
 * degrades into a search box instead of a brick.
 *
 * Sold-out items are filtered out: a suggestion the customer can't act on
 * is worse than no suggestion.
 */
export function fallbackMatch(
  menu: Menu,
  text: string,
  limit = 3,
): MenuSuggestion[] {
  const words = tokenize(text);
  if (words.length === 0) return [];

  const scored = new Map<string, { hit: MenuSuggestion; score: number }>();

  for (const category of menu.categories) {
    for (const item of menu.itemsBySlug.get(category.slug) ?? []) {
      if (item.soldOut) continue;
      const haystack = item.name.toLowerCase();
      let score = 0;
      for (const w of words) if (haystack.includes(w)) score += 1;
      if (score === 0) continue;

      const prev = scored.get(item.id);
      if (prev && prev.score >= score) continue;
      scored.set(item.id, {
        score,
        hit: { itemId: item.id, itemName: item.name, categorySlug: category.slug },
      });
    }
  }

  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.hit);
}
