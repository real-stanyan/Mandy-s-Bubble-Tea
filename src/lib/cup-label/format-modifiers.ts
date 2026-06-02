import "server-only";
import type { OrderLineItem } from "square";

// Modifier formatting for the live ZD410 70mm cup label (back sticker).
// Diverges intentionally from printer-client/src/zpl.ts, which still
// abbreviates ice/sugar because it targets the retired 40x30mm ZD411
// sticker where the bottom band can't fit full names. The wider ZD410
// layout has room, so we spell them out here.
// Format: `Topping1+Topping2(N) -> Less Ice -> Half Sugar`
//   - Toppings joined with `+`. Same-name aggregated as `Name(N)` when N>1.
//   - Non-default milk prepended to toppings (Oat Milk / Soy / Almond / Fresh).
//   - Defaults ("Normal Ice", "Standard Sugar", "Standard(Recommended)") omitted.
//   - Ice / sugar printed with their full Square modifier names — the wider
//     2026 cup-label layout has room for the bottom band to spell them out
//     (e.g. "Less Ice" / "Less Sugar (75%)") instead of the old abbreviations.

function isDefaultLevel(v: string | null | undefined): boolean {
  if (!v) return false;
  return /^\s*(normal|standard)\b/i.test(v);
}

function isDefaultMilk(name: string): boolean {
  return /\brecommended\b|^\s*standard\b/i.test(name);
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

  // Each attribute gets its own line so the bottom band reads vertically
  // rather than smushing everything into a single `+`/` -> ` string. Order
  // mirrors how staff scan a cup: milk substitution first, then toppings,
  // then ice level, then sugar level. Lines are joined with `\n`; the
  // renderer's wrapModifierLine splits on it before further word-wrap.
  const lines: string[] = [];
  if (milk) lines.push(milk);

  const toppingParts: string[] = [];
  for (const [name, count] of toppingCounts) {
    toppingParts.push(count > 1 ? `${name}(${count})` : name);
  }
  if (toppingParts.length > 0) lines.push(toppingParts.join(" + "));

  if (!isDefaultLevel(ice) && ice) lines.push(ice.trim());
  if (!isDefaultLevel(sugar) && sugar) lines.push(sugar.trim());

  // All-default order → empty string keeps the bottom band blank, same
  // as the previous single-line behaviour.
  return lines.join("\n");
}
