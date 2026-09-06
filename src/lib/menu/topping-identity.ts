// Every topping gets a face: a glyph shape, its own colour, and a texture
// group — the three cues the toppings grid uses so "Herbal Jelly" and
// "Grape Jelly" stop being two identical chips. Shapes and colours follow
// cup-visual (the same piece drops into the cup preview when a tile is
// picked), extended with the toppings the cup draws as foam or crust rather
// than pieces. Name-driven and longest-match, like cup-visual, so a Square
// rename degrades to a neutral tile rather than a crash.
//
// Mirror of the App's lib/menu/topping-identity.ts (2026-09-06) — keep in step.
// Verified against the production TOPPING list on 2026-09-06 (19 options).

export type ToppingGroup = "chewy" | "popping" | "jelly" | "creamy" | "crunch" | "other";

export type ToppingGlyph =
  | "pearl"
  | "pop"
  | "sphere"
  | "cube"
  | "rainbow"
  | "aloe"
  | "sago"
  | "crumb"
  | "pudding"
  | "foam"
  | "brulee";

export type ToppingIdentity = {
  /** Table key that matched, or 'unknown'. */
  key: string;
  group: ToppingGroup;
  glyph: ToppingGlyph;
  /** Body colour of the pieces. */
  color: string;
  /** A darker relative for borders and tags — light toppings need one to be seen. */
  edge: string;
  /** Colours cycled per piece (rainbow jelly). */
  colors?: string[];
};

type Spec = Omit<ToppingIdentity, "key">;

const TABLE: Record<string, Spec> = {
  // chewy
  pearls: { group: "chewy", glyph: "pearl", color: "#3B2317", edge: "#3B2317" },
  pearl: { group: "chewy", glyph: "pearl", color: "#3B2317", edge: "#3B2317" },
  boba: { group: "chewy", glyph: "pearl", color: "#3B2317", edge: "#3B2317" },
  sago: { group: "chewy", glyph: "sago", color: "#EFE8DA", edge: "#C9BC9C" },
  "jelly ball": { group: "chewy", glyph: "sphere", color: "#C8905A", edge: "#A9743F" },
  // popping
  "strawberry popping": { group: "popping", glyph: "pop", color: "#D93A3F", edge: "#B52C31" },
  "green apple popping": { group: "popping", glyph: "pop", color: "#8FC24A", edge: "#6FA034" },
  "oat popping": { group: "popping", glyph: "pop", color: "#E9DCBE", edge: "#C9B98F" },
  "chocolate popping": { group: "popping", glyph: "pop", color: "#5A3A2C", edge: "#5A3A2C" },
  popping: { group: "popping", glyph: "pop", color: "#E8703F", edge: "#C25A2B" },
  // jelly
  "mango jelly": { group: "jelly", glyph: "cube", color: "#F0A93B", edge: "#C9861F" },
  "lychee jelly": { group: "jelly", glyph: "cube", color: "#F2E7CE", edge: "#CDBA8F" },
  "rainbow jelly": {
    group: "jelly",
    glyph: "rainbow",
    color: "#E9A24A",
    edge: "#7CC47F",
    colors: ["#E2645F", "#7CC47F", "#5FA8D6", "#EBA24A", "#A87FC4", "#E9D257"],
  },
  "herbal jelly": { group: "jelly", glyph: "cube", color: "#2E2A2C", edge: "#2E2A2C" },
  "grass jelly": { group: "jelly", glyph: "cube", color: "#2E2A2C", edge: "#2E2A2C" },
  "grape jelly": { group: "jelly", glyph: "cube", color: "#8E6FA8", edge: "#6E4F8C" },
  "coffee jelly": { group: "jelly", glyph: "cube", color: "#5B4030", edge: "#3F2A1E" },
  "aloe vera": { group: "jelly", glyph: "aloe", color: "#DCE8CE", edge: "#8DB07A" },
  jelly: { group: "jelly", glyph: "cube", color: "#F2E7CE", edge: "#CDBA8F" },
  // creamy
  pudding: { group: "creamy", glyph: "pudding", color: "#F4CE6A", edge: "#C98A3C" },
  "cheese cream": { group: "creamy", glyph: "foam", color: "#FBF1DF", edge: "#D4BE93" },
  brulee: { group: "creamy", glyph: "brulee", color: "#E0A557", edge: "#A96A26" },
  "red bean": { group: "creamy", glyph: "sphere", color: "#7B3B36", edge: "#5E2B27" },
  // crunch
  oreo: { group: "crunch", glyph: "crumb", color: "#241F1D", edge: "#241F1D" },
};

const KEYS = Object.keys(TABLE).sort((a, b) => b.length - a.length);

const FALLBACK: Spec = { group: "other", glyph: "cube", color: "#C8A681", edge: "#8D5524" };

const norm = (s: string) => s.trim().toLowerCase();

export function toppingIdentity(name: string): ToppingIdentity {
  const n = norm(name);
  const key = KEYS.find((k) => n.includes(k));
  return key ? { key, ...TABLE[key] } : { key: "unknown", ...FALLBACK };
}

export const TOPPING_GROUP_ORDER: ToppingGroup[] = ["chewy", "popping", "jelly", "creamy", "crunch", "other"];

export const TOPPING_GROUP_LABEL: Record<ToppingGroup, string> = {
  chewy: "Chewy",
  popping: "Popping",
  jelly: "Jelly",
  creamy: "Creamy",
  crunch: "Crunch",
  other: "More",
};

/** Marker colour for a group header — the group's most typical topping. */
export const TOPPING_GROUP_COLOR: Record<ToppingGroup, string> = {
  chewy: "#3B2317",
  popping: "#D93A3F",
  jelly: "#8E6FA8",
  creamy: "#C98A3C",
  crunch: "#241F1D",
  other: "#8D5524",
};

/**
 * Bucket options into groups, keeping catalog order inside each group and
 * dropping empty groups. Works on any object with a name.
 */
export function groupToppings<T extends { name: string }>(
  options: T[],
): { group: ToppingGroup; items: { option: T; identity: ToppingIdentity }[] }[] {
  const buckets = new Map<ToppingGroup, { option: T; identity: ToppingIdentity }[]>();
  for (const option of options) {
    const identity = toppingIdentity(option.name);
    const list = buckets.get(identity.group) ?? [];
    list.push({ option, identity });
    buckets.set(identity.group, list);
  }
  return TOPPING_GROUP_ORDER.filter((g) => buckets.has(g)).map((group) => ({ group, items: buckets.get(group)! }));
}
