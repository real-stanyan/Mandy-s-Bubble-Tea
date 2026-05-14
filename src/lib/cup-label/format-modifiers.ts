import "server-only";
import type { OrderLineItem } from "square";

// Mirror of printer-client/src/zpl.ts modifier formatting so cup labels
// printed via TSP100 read the same way as Zebra stickers.
// Format: `Topping1+Topping2(N) -> L.Ice -> 50%S`
//   - Toppings joined with `+`. Same-name aggregated as `Name(N)` when N>1.
//   - Non-default milk prepended to toppings (Oat Milk / Soy / Almond / Fresh).
//   - Defaults ("Normal Ice", "Standard Sugar", "Standard(Recommended)") omitted.
//   - Ice / sugar abbreviated to fit in the bottom band of the cup label.

const ICE_ABBREVS: Record<string, string> = {
  "less ice": "L.Ice",
  "extra ice": "E.Ice",
  "no ice": "N.Ice",
  "warm": "Warm",
};

const SUGAR_ABBREVS: Record<string, string> = {
  "less sugar (75%)": "75%S",
  "less sugar 75%": "75%S",
  "less sugar": "75%S",
  "half sugar": "50%S",
  "little sugar (25%)": "25%S",
  "little sugar 25%": "25%S",
  "little sugar": "25%S",
  "no sugar": "0%S",
  "extra sugar": "+S",
};

function isDefaultLevel(v: string | null | undefined): boolean {
  if (!v) return false;
  return /^\s*(normal|standard)\b/i.test(v);
}

function isDefaultMilk(name: string): boolean {
  return /\brecommended\b|^\s*standard\b/i.test(name);
}

function abbreviate(table: Record<string, string>, v: string | null): string {
  if (!v) return "";
  const key = v.trim().toLowerCase().replace(/\s+/g, " ");
  return table[key] ?? v.trim();
}

function bucketOf(name: string): "sugar" | "ice" | "milk" | "topping" {
  const n = name.toLowerCase();
  if (n.includes("sugar")) return "sugar";
  if (n.includes("ice") || n.trim() === "warm") return "ice";
  if (n.includes("milk") || n.includes("recommended")) return "milk";
  return "topping";
}

export function formatModifiersForLabel(line: OrderLineItem): string {
  const toppingCounts = new Map<string, number>();
  let ice: string | null = null;
  let sugar: string | null = null;
  let milk: string | null = null;

  for (const m of line.modifiers ?? []) {
    const name = m.name ?? "";
    if (!name) continue;
    const b = bucketOf(name);
    if (b === "topping") {
      const qty = Math.max(1, parseInt(m.quantity ?? "1", 10) || 1);
      toppingCounts.set(name, (toppingCounts.get(name) ?? 0) + qty);
    } else if (b === "ice") {
      ice = name;
    } else if (b === "sugar") {
      sugar = name;
    } else if (b === "milk") {
      if (!isDefaultMilk(name)) milk = name;
    }
  }

  const toppingParts: string[] = [];
  if (milk) toppingParts.push(milk);
  for (const [name, count] of toppingCounts) {
    toppingParts.push(count > 1 ? `${name}(${count})` : name);
  }
  const toppings = toppingParts.join("+");

  const iceText = isDefaultLevel(ice) ? "" : abbreviate(ICE_ABBREVS, ice);
  const sugarText = isDefaultLevel(sugar) ? "" : abbreviate(SUGAR_ABBREVS, sugar);

  // Match Zebra zpl.ts: when nothing to print (all defaults), emit empty
  // string. The cup-label render's bottom band stays blank instead of
  // showing a noisy placeholder.
  return [toppings, iceText, sugarText].filter(s => s.length > 0).join(" -> ");
}
