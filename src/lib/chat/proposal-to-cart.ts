import type { CartLine } from "@/store/cart";
import type { ValidatedProposal } from "@/lib/chat/validate-proposal";

/** The proposal exactly as /api/chat serializes it — amounts are decimal
 *  strings because BigInt does not survive JSON. Field-for-field match to
 *  the `proposal` object built in src/app/api/chat/route.ts's POST handler
 *  (validated.ok branch) — keep the two in sync by hand, there is no shared
 *  type between server and client here since the server payload is only
 *  ever assembled as an inline object literal. */
export type ApiProposal = {
  itemId: string;
  itemName: string;
  imageUrl: string | null;
  categorySlug: string;
  variationId: string;
  variationName: string;
  variationPriceCents: string;
  modifiers: { id: string; name: string; priceCents: string }[];
  quantity: number;
  unitPriceCents: string;
  totalCents: string;
  reason: string;
};

/** Serialize a validated, catalog-priced proposal into the wire shape
 *  /api/chat returns. This is the other half of the round trip:
 *  `toApiProposal` (server, BigInt -> string) here, `proposalToCartLine`
 *  (client, string -> BigInt) below. They live in the same file, next to
 *  the test that proves the round trip preserves cart identity, so the
 *  two halves can't drift out of sync unnoticed the way an inline object
 *  literal in route.ts and a hand-written client type could. */
export function toApiProposal(v: ValidatedProposal): ApiProposal {
  return {
    itemId: v.line.itemId,
    itemName: v.line.itemName,
    imageUrl: v.line.itemImageUrl,
    categorySlug: v.categorySlug,
    variationId: v.line.variationId,
    variationName: v.line.variationName,
    variationPriceCents: v.line.variationPriceCents.toString(),
    modifiers: v.line.modifiers.map((m) => ({
      id: m.id,
      name: m.name,
      priceCents: m.priceCents.toString(),
    })),
    quantity: v.quantity,
    unitPriceCents: v.unitPriceCents.toString(),
    totalCents: v.totalCents.toString(),
    reason: v.reason,
  };
}

/** Rehydrate a server proposal into the exact shape addLine() expects.
 *  Modifier order is preserved verbatim: cart.ts derives a line's identity
 *  from its modifier ids (signatureFor sorts them before hashing, so order
 *  doesn't affect identity), but the *count* of each modifier id is what
 *  the price math and the modifier list depend on — dropping or collapsing
 *  a repeated modifier here would silently undercharge or under-render.
 *  Every amount is rebuilt with BigInt() before it can reach the cart —
 *  the store treats money as BigInt cents everywhere and a JS number must
 *  never touch it. */
export function proposalToCartLine(
  p: ApiProposal,
): Omit<CartLine, "id" | "quantity"> {
  return {
    itemId: p.itemId,
    itemName: p.itemName,
    itemImageUrl: p.imageUrl,
    variationId: p.variationId,
    variationName: p.variationName,
    variationPriceCents: BigInt(p.variationPriceCents),
    modifiers: p.modifiers.map((m) => ({
      id: m.id,
      name: m.name,
      priceCents: BigInt(m.priceCents),
    })),
  };
}
