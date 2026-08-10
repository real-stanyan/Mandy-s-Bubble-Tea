import type { Menu, ModifierList } from "@/lib/catalog";
import { getItemDetail } from "@/lib/catalog";

/** Cents to a plain dollar string. Local to the digest because the model
 *  reads dollars, not the cent integers the rest of the codebase passes
 *  around. */
function dollars(cents: bigint | null): string {
  if (cents == null) return "$0.00";
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  return `${neg ? "-" : ""}$${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

/** Human-readable bounds for one modifier list, so the model knows whether
 *  it must pick something and how many it may pick. */
function boundsLabel(ml: ModifierList): string {
  const parts: string[] = [];
  if (ml.minSelected === 0) parts.push("optional");
  else if (ml.minSelected === 1 && ml.maxSelected === 1) parts.push("pick exactly 1");
  else parts.push(`pick at least ${ml.minSelected}`);
  if (ml.maxDistinct != null) parts.push(`max ${ml.maxDistinct} different`);
  if (ml.maxPerKind != null && ml.maxPerKind > 1) parts.push(`max ${ml.maxPerKind} of each`);
  return parts.join(", ");
}

/**
 * Flatten the Square menu into compact text for the model's system prompt.
 *
 * Only ids and names go in — never a price the model is expected to repeat
 * back. Prices appear so the model can reason about "cheap" or "under $8",
 * but the authoritative amount is always recomputed server-side from the
 * catalog in validate-proposal.ts.
 *
 * Sold-out variations and modifiers are dropped rather than annotated: an
 * option the model can't see is an option it can't propose, which is one
 * fewer validation round-trip. Sold-out *items* stay in, marked, because a
 * customer asking for one deserves "that's sold out today" instead of the
 * model pretending the drink doesn't exist.
 */
export function buildMenuDigest(menu: Menu): string {
  const out: string[] = [];

  for (const cat of menu.categories) {
    const items = menu.itemsBySlug.get(cat.slug) ?? [];
    if (items.length === 0) continue;
    out.push(`## ${cat.squareName} (categorySlug: ${cat.slug})`);

    for (const item of items) {
      const detail = getItemDetail(menu, cat.slug, item.id);
      const soldOut = item.soldOut ? " [SOLD OUT]" : "";
      const desc = item.description ? ` — ${item.description}` : "";
      out.push(`- ${item.name}${desc} (itemId: ${item.id})${soldOut}`);

      for (const v of item.variations) {
        if (v.soldOut) continue;
        out.push(`  - size: ${v.name} ${dollars(v.priceCents)} (variationId: ${v.id})`);
      }

      for (const ml of detail?.modifierLists ?? []) {
        const available = ml.modifiers.filter((m) => !m.soldOut);
        if (available.length === 0) continue;
        out.push(`  - ${ml.name} [${boundsLabel(ml)}]:`);
        for (const m of available) {
          const up = m.priceCents ? ` +${dollars(m.priceCents)}` : "";
          const def = m.onByDefault ? " (default)" : "";
          out.push(`    - ${m.name}${up}${def} (modifierId: ${m.id})`);
        }
      }
    }
    out.push("");
  }

  return out.join("\n");
}
