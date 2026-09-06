// Milk is not an axis (sugar, ice) and not a bag (toppings): five different
// things, one of them the house default, and the thing customers actually
// ask at the counter is "what is Standard?" — fresh milk plus Mandy's milk
// powder. Square only gives us the names, so this file gives each milk a
// face (a carton or a bottle, its own colours), a kind (dairy / plant) and
// the one-line answer. Name-driven and longest-match like the topping table,
// so a rename in Square degrades to a plain carton rather than a crash.
//
// Mirror of the App's lib/menu/milk-identity.ts (2026-09-06) — keep in step.
// Verified against the production ALTERNATIVE MILK list on 2026-09-06:
//   Standard(Recommended) · Fresh Milk · Soy Milk · Oat Milk · Almond Milk

export type MilkKind = "dairy" | "plant" | "other";

export type MilkGlyph = "blend" | "bottle" | "soy" | "oat" | "almond" | "coconut" | "carton";

export type MilkIdentity = {
  /** Table key that matched, or 'unknown'. */
  key: string;
  kind: MilkKind;
  glyph: MilkGlyph;
  /** Carton / bottle body colour. */
  body: string;
  /** The label band on the carton; also the card's picked border. */
  band: string;
  /** What it is, in one line — shown under the strip for the picked milk. */
  blurb: string;
  /** The house default; wears the RECOMMENDED ribbon. */
  recommended: boolean;
};

type Spec = Omit<MilkIdentity, "key">;

const TABLE: Record<string, Spec> = {
  standard: {
    kind: "dairy",
    glyph: "blend",
    body: "#F3E7D3",
    band: "#C9A96E",
    blurb: "Fresh milk + Mandy's milk powder — creamier, the house way",
    recommended: true,
  },
  "fresh milk": {
    kind: "dairy",
    glyph: "bottle",
    body: "#FFFFFF",
    band: "#5FA8D6",
    blurb: "Pure fresh milk, nothing added — lighter, cleaner",
    recommended: false,
  },
  "lactose free": {
    kind: "dairy",
    glyph: "bottle",
    body: "#FFFFFF",
    band: "#7FB7A8",
    blurb: "Dairy without the lactose — tastes like fresh milk",
    recommended: false,
  },
  soy: {
    kind: "plant",
    glyph: "soy",
    body: "#F1E6CF",
    band: "#B99A5B",
    blurb: "Plant-based · smooth, a little nutty",
    recommended: false,
  },
  oat: {
    kind: "plant",
    glyph: "oat",
    body: "#EADFC6",
    band: "#A8895A",
    blurb: "Plant-based · soft and mellow, the closest to dairy",
    recommended: false,
  },
  almond: {
    kind: "plant",
    glyph: "almond",
    body: "#EBDCCB",
    band: "#9C6B45",
    blurb: "Plant-based · light, a hint of almond",
    recommended: false,
  },
  coconut: {
    kind: "plant",
    glyph: "coconut",
    body: "#F4F1EA",
    band: "#6E8F5E",
    blurb: "Plant-based · a touch of coconut",
    recommended: false,
  },
};

const KEYS = Object.keys(TABLE).sort((a, b) => b.length - a.length);

const FALLBACK: Spec = {
  kind: "other",
  glyph: "carton",
  body: "#EFE6D8",
  band: "#B49A72",
  blurb: "",
  recommended: false,
};

const norm = (s: string) => s.trim().toLowerCase();

export function milkIdentity(name: string): MilkIdentity {
  const n = norm(name);
  const key = KEYS.find((k) => n.includes(k));
  return key ? { key, ...TABLE[key] } : { key: "unknown", ...FALLBACK };
}

/** Which Square lists are the milk choice. */
export function isMilkList(listName: string | null | undefined): boolean {
  return (listName ?? "").toUpperCase().includes("MILK");
}

/** "Standard(Recommended)" → "Standard": the ribbon says recommended, the name needn't. */
export function milkDisplayName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*/g, " ").trim();
}

export const MILK_KIND_LABEL: Record<MilkKind, string> = {
  dairy: "Dairy",
  plant: "Plant-based",
  other: "",
};
