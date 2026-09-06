// Turns a customer's modifier picks into the numbers the live cup preview
// draws with. Pure and name-driven, kept out of the component so the mapping
// is testable and so an unrecognised modifier degrades to something sane
// rather than throwing in the middle of a render.
//
// Name-driven, not id-driven, on purpose: modifier ids are Square's and change
// whenever the catalog is rebuilt, while the customer-facing names are what
// the shop actually maintains. Anything we don't recognise simply doesn't draw
// — the cup is decoration for a form that is still the source of truth.
//
// Tables below were rebuilt from the live Square catalog on 2026-08-08 (92
// items, 35 modifiers) after the first pass guessed. If a drink or topping is
// added in Square and nothing appears in the cup, this is the file to edit.

export type Sugar = 0 | 0.25 | 0.5 | 0.75 | 1 | 1.25;
export type Ice = "none" | "less" | "normal" | "extra" | "warm";
export type ToppingShape = "pearl" | "cube" | "sphere" | "crumb";

/** Where a topping ends up in the cup. Most sink; crushed cookie floats. */
export type ToppingPlacement = "bottom" | "top";

export type ToppingVisual = {
  /** The modifier's own name — doubles as the React key, so it must be stable. */
  name: string;
  shape: ToppingShape;
  /** One colour normally; several means each piece cycles through them. */
  colors: string[];
  /** How many the customer picked. Drives layer thickness, not piece count. */
  count: number;
  placement: ToppingPlacement;
};

export type CupVisual = {
  liquid: string;
  liquidLight: string;
  sugar: Sugar;
  ice: Ice;
  toppings: ToppingVisual[];
  hasFoam: boolean;
  hasBrulee: boolean;
  /** A milk swap ("oat milk"), or null on the house standard. Caption only — the cup draws the same liquid. */
  milk: string | null;
};

type Picked = { name: string; count: number };

const norm = (s: string) => s.trim().toLowerCase();

/* ---------------------------- liquid ---------------------------- */

// Two tiers, and the tiers are the point. "Yakult Green Tea" and "Grapefruit
// Black Tea" both contain a base-tea keyword, and a flat longest-match table
// paints them as tea. A flavour always beats the base it is built on, so
// flavours are consulted first and only then the bases.
//
// Within a tier, longest keyword wins. That is what stops "Grapefruit" being
// eaten by "Grape" — the first version of this file painted grapefruit tea
// purple, and both drinks are on the real menu.

const FLAVOURS: Record<string, [string, string]> = {
  "brown sugar": ["#6F4425", "#8C5C36"],
  "brown rice": ["#C8AD84", "#D8C3A2"],
  "cookies & cream": ["#7A6E63", "#98897C"],
  "cookies and cream": ["#7A6E63", "#98897C"],
  "red dragon fruit": ["#C2568A", "#D677A4"],
  "passion fruit": ["#EFBE4B", "#F5D175"],
  "green apple": ["#A7C468", "#BED68B"],
  "honey citron": ["#E7B84D", "#F0CD7E"],
  "honey ginger": ["#D9A24E", "#E6BC7C"],
  grapefruit: ["#E8703F", "#F18F64"],
  honeydew: ["#C4DB9E", "#D6E7BA"],
  wintermelon: ["#C79A63", "#D8B387"],
  watermelon: ["#E4697A", "#EE8B98"],
  strawberry: ["#DE8078", "#EC9E97"],
  blueberry: ["#6E7CB8", "#8E9ACC"],
  pineapple: ["#EFCB5B", "#F5DC8A"],
  chocolate: ["#5A3A2C", "#77503E"],
  "earl grey": ["#BC9A72", "#CFB292"],
  "four seasons": ["#C2CE9B", "#D4DDB6"],
  caramel: ["#C08A4A", "#D2A470"],
  coconut: ["#F1EBE0", "#F8F4EC"],
  jasmine: ["#D3BE95", "#E1D1B1"],
  banana: ["#F0DC8B", "#F6E9B3"],
  matcha: ["#7C9A58", "#95B172"],
  yakult: ["#F6EFD9", "#FBF7EA"],
  lychee: ["#EDE0C6", "#F5ECDC"],
  orange: ["#F0913C", "#F6AE6B"],
  oolong: ["#C0A176", "#D2B994"],
  ceylon: ["#B08A63", "#C5A585"],
  coffee: ["#6E4B33", "#8A6547"],
  guava: ["#E9A0A0", "#F1BCBC"],
  grape: ["#8B6BA6", "#A489BB"],
  mango: ["#EFA53A", "#F6BE68"],
  peach: ["#F0B08A", "#F6C7A9"],
  lemon: ["#E4CE63", "#EEDE8C"],
  honey: ["#E0B65C", "#EACB89"],
  mint: ["#9FD1B4", "#BCE0CB"],
  oreo: ["#6E6157", "#8A7C71"],
  taro: ["#A48BC4", "#BCA7D6"],
  thai: ["#DF8A4C", "#EAA877"],
  sago: ["#EFE8DA", "#F7F2E9"],
};

const BASES: Record<string, [string, string]> = {
  "green tea": ["#AFC58C", "#C4D5A9"],
  "black tea": ["#B08A63", "#C5A585"],
  "milk tea": ["#C8A681", "#D9BDA0"],
  "fresh milk": ["#F4EEE2", "#FAF7EF"],
  frappe: ["#C8A681", "#D9BDA0"],
  slushy: ["#C8A681", "#D9BDA0"],
  cheese: ["#C8A681", "#D9BDA0"],
  tea: ["#C0A176", "#D2B994"],
};

const DEFAULT_LIQUID: [string, string] = ["#C8A681", "#D9BDA0"];

const byLengthDesc = (a: string, b: string) => b.length - a.length;
const FLAVOUR_KEYS = Object.keys(FLAVOURS).sort(byLengthDesc);
const BASE_KEYS = Object.keys(BASES).sort(byLengthDesc);

function liquidFor(drinkName: string): [string, string] {
  const n = norm(drinkName);
  for (const k of FLAVOUR_KEYS) if (n.includes(k)) return FLAVOURS[k];
  for (const k of BASE_KEYS) if (n.includes(k)) return BASES[k];
  return DEFAULT_LIQUID;
}

/* -------------------------- sugar & ice -------------------------- */

function sugarFrom(picked: Picked[]): Sugar {
  for (const p of picked) {
    const n = norm(p.name);
    if (!n.includes("sugar")) continue;
    if (n.includes("extra")) return 1.25;
    if (n.includes("no sugar")) return 0;
    if (n.includes("25%") || n.includes("little")) return 0.25;
    if (n.includes("half") || n.includes("50%")) return 0.5;
    if (n.includes("75%") || n.includes("less")) return 0.75;
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
    if (n.includes("extra")) return "extra";
    return "normal";
  }
  return "normal";
}

/* --------------------------- toppings --------------------------- */

type ToppingSpec = {
  shape: ToppingShape;
  colors: string[];
  placement?: ToppingPlacement;
};

// Keys are matched longest-first for the same reason the drinks are: "oat
// popping" has to beat "oat", and "grape jelly" has to not be confused with a
// grape drink.
//
// Milk swaps (Fresh / Oat / Soy / Almond Milk) are deliberately absent — they
// change the drink, not what is sitting in the bottom of it, and drawing them
// as pieces would be a lie.
const TOPPINGS: Record<string, ToppingSpec> = {
  "green apple popping": { shape: "sphere", colors: ["#8FC24A"] },
  "chocolate popping": { shape: "sphere", colors: ["#5A3A2C"] },
  "strawberry popping": { shape: "sphere", colors: ["#D93A3F"] },
  "oat popping": { shape: "sphere", colors: ["#EFE6D2"] },
  "rainbow jelly": {
    shape: "cube",
    // Cycled per piece — this one is meant to look like a handful of colours.
    colors: ["#E2645F", "#EBA24A", "#E9D257", "#7CC47F", "#5FA8D6", "#A87FC4"],
  },
  "coffee jelly": { shape: "cube", colors: ["#5B4030"] },
  "lychee jelly": { shape: "cube", colors: ["#F2E7CE"] },
  "mango jelly": { shape: "cube", colors: ["#F0A93B"] },
  "grape jelly": { shape: "cube", colors: ["#8E6FA8"] },
  "herbal jelly": { shape: "cube", colors: ["#2E2A2C"] },
  "grass jelly": { shape: "cube", colors: ["#2E2A2C"] },
  "jelly ball": { shape: "sphere", colors: ["#C8905A"] },
  "aloe vera": { shape: "cube", colors: ["#DCE8CE"] },
  "red bean": { shape: "sphere", colors: ["#7B3B36"] },
  pudding: { shape: "cube", colors: ["#F4CE6A"] },
  pearls: { shape: "pearl", colors: ["#3B2317"] },
  pearl: { shape: "pearl", colors: ["#3B2317"] },
  boba: { shape: "pearl", colors: ["#3B2317"] },
  sago: { shape: "sphere", colors: ["#EFE8DA"] },
  // Crushed cookie floats on the drink rather than sinking through it.
  oreo: { shape: "crumb", colors: ["#241F1D"], placement: "top" },
};

const TOPPING_KEYS = Object.keys(TOPPINGS).sort(byLengthDesc);

function toppingsFrom(picked: Picked[]): ToppingVisual[] {
  const out: ToppingVisual[] = [];
  const seen = new Set<string>();
  for (const p of picked) {
    if (p.count <= 0) continue;
    const n = norm(p.name);
    const key = TOPPING_KEYS.find((k) => n.includes(k));
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const spec = TOPPINGS[key];
    out.push({
      name: p.name,
      shape: spec.shape,
      colors: spec.colors,
      count: p.count,
      placement: spec.placement ?? "bottom",
    });
  }
  return out;
}

function hasNamed(picked: Picked[], needle: string): boolean {
  return picked.some((p) => p.count > 0 && norm(p.name).includes(needle));
}

// The ALTERNATIVE MILK list: "Fresh Milk", "Oat Milk"… name the milk; the
// default is "Standard(Recommended)". Requires the word milk so that "Oat
// Popping" (a topping) is not read as a swap.
function milkFrom(picked: Picked[]): string | null {
  const swap = picked.find(
    (p) => p.count > 0 && norm(p.name).includes("milk") && !norm(p.name).includes("standard"),
  );
  return swap ? norm(swap.name) : null;
}

/* -------------------------- entry point -------------------------- */

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
    milk: milkFrom(picked),
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
        : v.sugar === 1.25
          ? "extra sugar"
          : `${v.sugar * 100}% sugar`,
  );
  bits.push(
    v.ice === "warm"
      ? "served warm"
      : v.ice === "none"
        ? "no ice"
        : v.ice === "less"
          ? "less ice"
          : v.ice === "extra"
            ? "extra ice"
            : "normal ice",
  );
  if (v.milk) bits.push(v.milk);
  const extras = [
    ...v.toppings.map((t) => (t.count > 1 ? `${t.name} ×${t.count}` : t.name)),
    ...(v.hasFoam ? ["cheese cream"] : []),
    ...(v.hasBrulee ? ["brûlée top"] : []),
  ];
  if (extras.length > 0) bits.push(`with ${extras.join(", ")}`);
  return bits.join(", ");
}
