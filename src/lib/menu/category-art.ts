// Which illustration a Square category gets (components/brand/CategoryArt),
// and the pastel it sits on — menu knowledge, separate from the motion maths
// in lib/motion/category-art so screens that only need a tint or a kind do
// not pull the motion vocabulary in.
//
// Mirror of the App's lib/menu/category-art.ts. Keep the two in lockstep.

export type CategoryArtKind =
  | "top10"
  | "milk"
  | "green"
  | "black"
  | "brew"
  | "frozen"
  | "cheese"
  | "mix"
  | "specials";

/** The pastel each illustration sits on — the eight the old tiles used, plus the specials' peach. Theme-invariant: pair with PIN ink. */
export const CATEGORY_ART_TINT: Record<CategoryArtKind, string> = {
  top10: "#FFE9B0",
  milk: "#F5E1C5",
  green: "#E3ECD2",
  black: "#F3D9C6",
  brew: "#E8DAC6",
  frozen: "#D8E4E8",
  cheese: "#FFF1D6",
  mix: "#E6DDEB",
  specials: "#FFE7CF",
};

const KIND_BY_KEY: Record<string, CategoryArtKind> = {
  weeklyspecials: "specials",
  specials: "specials",
  top10: "top10",
  milktea: "milk",
  milky: "milk",
  fruitygreentea: "green",
  fruity: "green",
  fruityblacktea: "black",
  freshbrew: "brew",
  frozen: "frozen",
  cheesecream: "cheese",
  specialmix: "mix",
};

/** Which illustration a category name gets (this week's specials included), or null for anything new in Square. */
export function categoryArtKind(
  name: string | null | undefined,
): CategoryArtKind | null {
  const key = (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return KIND_BY_KEY[key] ?? null;
}
