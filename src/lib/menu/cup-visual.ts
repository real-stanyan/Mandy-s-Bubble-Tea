// Turns a customer's modifier picks into the numbers the live cup preview
// draws with. Pure and name-driven, kept out of the component so the mapping
// is testable and so an unrecognised modifier degrades to something sane
// rather than throwing in the middle of a render.
//
// Name-driven, not id-driven, on purpose: modifier ids are Square's and change
// whenever the catalog is rebuilt, while the customer-facing names are what
// the shop actually maintains. Anything we don't recognise simply doesn't draw
// — the cup is decoration for a form that is still the source of truth.

export type Sugar = 0 | 0.25 | 0.5 | 0.75 | 1;
export type Ice = "none" | "less" | "normal" | "warm";
export type ToppingShape = "pearl" | "cube" | "sphere";

export type ToppingVisual = {
  /** The modifier's own name — doubles as the React key, so it must be stable. */
  name: string;
  shape: ToppingShape;
  color: string;
  /** How many the customer picked; the drawing caps what it actually renders. */
  count: number;
};

export type CupVisual = {
  /** Body of the drink. */
  liquid: string;
  /** Slightly lighter tone used for the meniscus and the gradient's top stop. */
  liquidLight: string;
  sugar: Sugar;
  ice: Ice;
  toppings: ToppingVisual[];
  /** Cheese-cream cap floats above the liquid. */
  hasFoam: boolean;
  /** Torched sugar crust sits above everything. */
  hasBrulee: boolean;
};

type Picked = { name: string; count: number };

const norm = (s: string) => s.trim().toLowerCase();

/* ---------------- liquid ---------------- */

// Ordered: the first keyword that appears in the drink name wins, so
// "Mango Iced Green Tea" reads as mango rather than green tea. Sorted
// longest-phrase-first within a flavour for the same reason.
const LIQUIDS: Array<[string, string, string]> = [
  ["brown sugar", "#6F4425", "#8C5C36"],
  ["cookies & cream", "#7A6E63", "#98897C"],
  ["cookies and cream", "#7A6E63", "#98897C"],
  ["oreo", "#6E6157", "#8A7C71"],
  ["chocolate", "#5A3A2C", "#77503E"],
  ["matcha", "#7C9A58", "#95B172"],
  ["taro", "#A48BC4", "#BCA7D6"],
  ["red dragon fruit", "#C2568A", "#D677A4"],
  ["dragon fruit", "#C2568A", "#D677A4"],
  ["strawberry", "#DE8078", "#EC9E97"],
  ["passion fruit", "#EFBE4B", "#F5D175"],
  ["mango", "#EFA53A", "#F6BE68"],
  ["peach", "#F0B08A", "#F6C7A9"],
  ["lychee", "#EDE0C6", "#F5ECDC"],
  ["grape", "#8B6BA6", "#A489BB"],
  ["green apple", "#A7C468", "#BED68B"],
  ["lemon", "#E4CE63", "#EEDE8C"],
  ["four seasons", "#BFCB99", "#D2DAB5"],
  ["coconut", "#F1EBE0", "#F8F4EC"],
  ["jasmine", "#D3BE95", "#E1D1B1"],
  ["oolong", "#C0A176", "#D2B994"],
  ["earl grey", "#BC9A72", "#CFB292"],
  ["winter melon", "#C79A63", "#D8B387"],
  // Generic bases last — they'd otherwise swallow every flavoured variant.
  ["green tea", "#AFC58C", "#C4D5A9"],
  ["black tea", "#B08A63", "#C5A585"],
  ["milk tea", "#C8A681", "#D9BDA0"],
];

const DEFAULT_LIQUID: [string, string] = ["#C8A681", "#D9BDA0"];

function liquidFor(drinkName: string): [string, string] {
  const n = norm(drinkName);
  for (const [needle, base, light] of LIQUIDS) {
    if (n.includes(needle)) return [base, light];
  }
  return DEFAULT_LIQUID;
}

/* ---------------- sugar & ice ---------------- */

function sugarFrom(picked: Picked[]): Sugar {
  for (const p of picked) {
    const n = norm(p.name);
    if (!n.includes("sugar")) continue;
    if (n.includes("no sugar")) return 0;
    if (n.includes("25%") || n.includes("little")) return 0.25;
    if (n.includes("half") || n.includes("50%")) return 0.5;
    if (n.includes("75%") || n.includes("less")) return 0.75;
    // "Standard Sugar", "Full Sugar", "100%"
    return 1;
  }
  return 1;
}

function iceFrom(picked: Picked[]): Ice {
  for (const p of picked) {
    const n = norm(p.name);
    if (n === "warm" || n === "hot") return "warm";
    if (!n.includes("ice")) continue;
    if (n.includes("no ice")) return "none";
    if (n.includes("less")) return "less";
    if (n.includes("extra")) return "normal";
    return "normal";
  }
  return "normal";
}

/* ---------------- toppings ---------------- */

// Everything that is a *thing floating in the cup*. Sugar, ice, size and the
// "Standard (Recommended)" default all fall through and draw nothing.
const TOPPINGS: Array<[string, ToppingShape, string]> = [
  ["pearl", "pearl", "#3B2317"],
  ["boba", "pearl", "#3B2317"],
  ["lychee jelly", "cube", "#F2E7CE"],
  ["mango jelly", "cube", "#F0A93B"],
  ["rainbow jelly", "cube", "#E27A9B"],
  ["herbal jelly", "cube", "#2E2A2C"],
  ["grass jelly", "cube", "#2E2A2C"],
  ["coconut jelly", "cube", "#F6F1E7"],
  ["aloe", "cube", "#DCE8CE"],
  ["pudding", "cube", "#F4CE6A"],
  ["red bean", "sphere", "#7B3B36"],
  ["strawberry popping", "sphere", "#E4788F"],
  ["popping", "sphere", "#E4788F"],
  ["jelly ball", "sphere", "#C8905A"],
  ["oreo", "cube", "#4A413B"],
];

function toppingsFrom(picked: Picked[]): ToppingVisual[] {
  const out: ToppingVisual[] = [];
  for (const p of picked) {
    if (p.count <= 0) continue;
    const n = norm(p.name);
    const hit = TOPPINGS.find(([needle]) => n.includes(needle));
    if (!hit) continue;
    out.push({ name: p.name, shape: hit[1], color: hit[2], count: p.count });
  }
  return out;
}

function hasNamed(picked: Picked[], needle: string): boolean {
  return picked.some((p) => p.count > 0 && norm(p.name).includes(needle));
}

/* ---------------- entry point ---------------- */

export function resolveCupVisual(args: {
  drinkName: string;
  /** Every modifier the customer currently has on, with its count. */
  picked: Picked[];
}): CupVisual {
  const picked = args.picked.filter((p) => p.count > 0);
  const [liquid, liquidLight] = liquidFor(args.drinkName);
  return {
    liquid,
    liquidLight,
    sugar: sugarFrom(picked),
    ice: iceFrom(picked),
    toppings: toppingsFrom(picked),
    hasFoam: hasNamed(picked, "cheese cream"),
    hasBrulee: hasNamed(picked, "brulee"),
  };
}

/**
 * One line of plain English for the build on screen. The cup is `aria-hidden`
 * decoration; this is what a screen reader gets instead, and it doubles as the
 * caption under the drawing.
 */
export function describeCup(v: CupVisual): string {
  const bits: string[] = [];
  bits.push(
    v.sugar === 0
      ? "no sugar"
      : v.sugar === 1
        ? "standard sugar"
        : `${v.sugar * 100}% sugar`,
  );
  bits.push(
    v.ice === "warm"
      ? "served warm"
      : v.ice === "none"
        ? "no ice"
        : v.ice === "less"
          ? "less ice"
          : "normal ice",
  );
  const extras = [
    ...v.toppings.map((t) => (t.count > 1 ? `${t.name} ×${t.count}` : t.name)),
    ...(v.hasFoam ? ["cheese cream"] : []),
    ...(v.hasBrulee ? ["brûlée top"] : []),
  ];
  if (extras.length > 0) bits.push(`with ${extras.join(", ")}`);
  return bits.join(", ");
}
