// Short brand blurbs per drink family. Square's category records have no
// description field, so the marketing copy lives here (used on the home
// category grid and the menu section headers). Keyed by upper-cased
// Square category name; unknown families fall back to an item count.

const CATEGORY_BLURBS: Record<string, string> = {
  MILKY: "Silky milk teas with chewy pearls — the classics.",
  FRUITY: "Bright, juicy fruit teas — refreshing every sip.",
  "SPECIAL MIX": "House blends you won't find anywhere else.",
  "FRESH BREW": "Pure brewed teas, clean and aromatic.",
  "FRUITY BLACK TEA": "Black tea meets fresh fruit — bold and zesty.",
  FROZEN: "Spoonable frozen slushies for hot days.",
  "CHEESE CREAM": "Crowned with velvety salted cheese foam.",
};

export function categoryBlurb(squareName: string, itemCount?: number): string {
  const hit = CATEGORY_BLURBS[squareName.toUpperCase()];
  if (hit) return hit;
  if (itemCount != null) {
    return `${itemCount} drink${itemCount !== 1 ? "s" : ""} to explore.`;
  }
  return "";
}
