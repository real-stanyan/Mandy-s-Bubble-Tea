"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { CARD_SURCHARGE_BPS, PH_SURCHARGE_BPS, PLATFORM_FEE_BPS } from "@/lib/constants";

// Cart state lives client-side only and is persisted to localStorage.
// Prices are stored as BigInt cents to match the rest of the codebase;
// a custom JSON replacer/reviver handles BigInt ↔ string for persistence.

export type CartLineModifier = {
  id: string;
  name: string;
  priceCents: bigint; // 0n for included/free modifiers
};

export type CartLine = {
  /** Stable id derived from (itemId + variationId + modifier ids). */
  id: string;
  itemId: string;
  itemName: string;
  itemImageUrl: string | null;
  variationId: string;
  variationName: string;
  variationPriceCents: bigint;
  modifiers: CartLineModifier[];
  quantity: number;
};

/** Per-cup label selection. Discriminated by `kind`. Stored in
 *  `labelSelections` under key `cupKey(lineId, cupIdx)`. Stays in sync
 *  with the RN app's `DoodleSlot` source priority (ai > photo > preset).
 */
export type CupLabelSelection =
  | { kind: "preset"; hash: string }
  | { kind: "photo"; uploadedDoodleId: string; previewUrl: string }
  // userDoodleId is null while the synchronous /api/doodle/upload call
  // is in flight. The Pay gate refuses pending draw slots so the user
  // can't ship a cup with an un-uploaded drawing.
  | { kind: "draw"; userDoodleId: string | null; pathCount: number }
  // aiDoodleId is null while the background submission to
  // /api/cup-label/ai-submit is in flight — committing the selection
  // optimistically lets the user close the dialog and keep going
  // through checkout while Doubao runs server-side. The real uuid
  // gets stamped onto the cart entry once the route returns.
  | { kind: "ai"; aiDoodleId: string | null; prompt: string };

type CartState = {
  lines: CartLine[];
  isOpen: boolean;
  hydrated: boolean;

  // Per-cup gallery / photo / AI selection. Key = cupKey
  // (`${lineId}:${cupIdx}`, 0-indexed), value = discriminated union of
  // the three source kinds. Matches the server `slotKey` exactly so
  // labelSelections forwards verbatim into payment payload maps.
  labelSelections: Record<string, CupLabelSelection>;

  /** Order-level opt-in: print a free keepsake copy of each customized cup. */
  keepLabelCopy: boolean;

  /** Scopes the per-slot AI submission quota on the server (see
   *  `/api/cup-label/ai-submit`). Regenerated on `clear()` so a new
   *  shopping session never inherits the previous cart's AI image. */
  cartSessionId: string;

  // Actions
  addLine: (line: Omit<CartLine, "id" | "quantity">, quantity?: number) => void;
  setQuantity: (lineId: string, quantity: number) => void;
  removeLine: (lineId: string) => void;
  clear: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  setLabel: (cupKey: string, selection: CupLabelSelection) => void;
  clearLabel: (cupKey: string) => void;
  setKeepLabelCopy: (value: boolean) => void;
};

/** Build the deterministic key for a single cup within a cart line.
 *  Matches server `slotKey` in src/lib/cup-label/enqueue.ts (single colon
 *  between lineId and cupIdx) so labelSelections forwards to presetStickerHashes
 *  as-is, no key transform needed. lineId is `signatureFor` output, which
 *  itself uses `::` internally — the trailing `:${cupIdx}` is unambiguous.
 */
export function cupKey(lineId: string, cupIdx: number): string {
  return `${lineId}:${cupIdx}`;
}

/** Drop every selection belonging to a removed line. */
function pruneSelectionsForLine(
  selections: Record<string, CupLabelSelection>,
  lineId: string,
): Record<string, CupLabelSelection> {
  const prefix = `${lineId}:`;
  const next: Record<string, CupLabelSelection> = {};
  for (const [k, v] of Object.entries(selections)) {
    if (!k.startsWith(prefix)) next[k] = v;
  }
  return next;
}

/** Drop selections for cup indices that no longer exist after a qty cut. */
function pruneSelectionsAboveCup(
  selections: Record<string, CupLabelSelection>,
  lineId: string,
  maxQty: number,
): Record<string, CupLabelSelection> {
  const prefix = `${lineId}:`;
  const next: Record<string, CupLabelSelection> = {};
  for (const [k, v] of Object.entries(selections)) {
    if (!k.startsWith(prefix)) {
      next[k] = v;
      continue;
    }
    const idx = Number(k.slice(prefix.length));
    if (Number.isFinite(idx) && idx < maxQty) next[k] = v;
  }
  return next;
}

/** Compute a signature that groups line items with identical contents.
 *  Mirrors `buildLineId` in the RN app and `clientLineIdFromSquareLine`
 *  on the server (src/lib/cup-label/client-line-id.ts) so the same
 *  lineId reaches the cup-label enqueue path from web, app, and the
 *  Square webhook. variationId already uniquely identifies the catalog
 *  variation (which transitively pins the parent item), so itemId is
 *  redundant and omitted to keep the algorithm aligned across surfaces.
 *  itemId is still accepted for API stability but ignored. */
function signatureFor(
  _itemId: string,
  variationId: string,
  modifiers: CartLineModifier[],
): string {
  const modIds = modifiers
    .map((m) => m.id)
    .sort()
    .join(",");
  return `${variationId}::${modIds}`;
}

/** UUID v4 with a graceful fallback for old Safari (pre-iOS 15.4). */
function newCartSessionId(): string {
  const c =
    typeof globalThis !== "undefined" && "crypto" in globalThis
      ? (globalThis.crypto as Crypto)
      : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const buf = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(buf);
  else for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      isOpen: false,
      hydrated: false,
      labelSelections: {},
      keepLabelCopy: false,
      cartSessionId: newCartSessionId(),

      addLine: (partial, quantity = 1) => {
        const id = signatureFor(
          partial.itemId,
          partial.variationId,
          partial.modifiers,
        );
        set((state) => {
          const existing = state.lines.find((l) => l.id === id);
          if (existing) {
            return {
              lines: state.lines.map((l) =>
                l.id === id ? { ...l, quantity: l.quantity + quantity } : l,
              ),
              isOpen: true,
            };
          }
          return {
            lines: [...state.lines, { ...partial, id, quantity }],
            isOpen: true,
          };
        });
      },

      setQuantity: (lineId, quantity) =>
        set((state) => {
          if (quantity <= 0) {
            const next = pruneSelectionsForLine(state.labelSelections, lineId);
            return {
              lines: state.lines.filter((l) => l.id !== lineId),
              labelSelections: next,
            };
          }
          const next = pruneSelectionsAboveCup(state.labelSelections, lineId, quantity);
          return {
            lines: state.lines.map((l) =>
              l.id === lineId ? { ...l, quantity } : l,
            ),
            labelSelections: next,
          };
        }),

      removeLine: (lineId) =>
        set((state) => ({
          lines: state.lines.filter((l) => l.id !== lineId),
          labelSelections: pruneSelectionsForLine(state.labelSelections, lineId),
        })),

      clear: () =>
        set({
          lines: [],
          labelSelections: {},
          keepLabelCopy: false,
          cartSessionId: newCartSessionId(),
        }),
      openDrawer: () => set({ isOpen: true }),
      closeDrawer: () => set({ isOpen: false }),
      setLabel: (key, selection) =>
        set((state) => ({
          labelSelections: { ...state.labelSelections, [key]: selection },
        })),
      clearLabel: (key) =>
        set((state) => {
          const next = { ...state.labelSelections };
          delete next[key];
          return { labelSelections: next };
        }),
      setKeepLabelCopy: (value) => set({ keepLabelCopy: value }),
    }),
    {
      name: "mandy-cart",
      version: 1,
      storage: createJSONStorage(() => localStorage, {
        replacer: (_key, value) =>
          typeof value === "bigint"
            ? { __bigint: value.toString() }
            : value,
        reviver: (_key, value) => {
          if (
            value &&
            typeof value === "object" &&
            "__bigint" in value &&
            typeof (value as { __bigint: unknown }).__bigint === "string"
          ) {
            return BigInt((value as { __bigint: string }).__bigint);
          }
          return value;
        },
      }),
      migrate: (persistedState: unknown, fromVersion: number) => {
        const next = (
          persistedState && typeof persistedState === "object"
            ? { ...(persistedState as Record<string, unknown>) }
            : {}
        ) as Partial<CartState>;
        if (fromVersion < 1) {
          next.labelSelections = {};
        }
        next.cartSessionId = newCartSessionId();
        return next as CartState;
      },
      partialize: (state) => ({
        lines: state.lines,
        labelSelections: state.labelSelections,
        keepLabelCopy: state.keepLabelCopy,
        cartSessionId: state.cartSessionId,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    },
  ),
);

// --- Derived selectors ------------------------------------------------------

/** Unit price for a line (variation + all modifier upcharges). */
export function lineUnitPrice(line: CartLine): bigint {
  return (
    line.variationPriceCents +
    line.modifiers.reduce((sum, m) => sum + m.priceCents, 0n)
  );
}

/** Total price for a line (unit × quantity). */
export function lineTotal(line: CartLine): bigint {
  return lineUnitPrice(line) * BigInt(line.quantity);
}

/** Cart subtotal across all lines. */
export function cartSubtotal(lines: CartLine[]): bigint {
  return lines.reduce((sum, l) => sum + lineTotal(l), 0n);
}

/** Total number of items across all lines. */
export function cartItemCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

// NOTE (2026-07-28): these three size the fee on whatever base they're handed,
// and every caller passes the plain cart subtotal. That's right for the cart
// drawer, where no discount exists yet — but Square computes SUBTOTAL_PHASE
// percentages on the POST-discount amount, so handing them a pre-discount
// subtotal at a discounted surface over-states the fee. Checkout used to do
// exactly that; it now renders /api/orders/quote instead (docs/adr/0005).

// Mirrors Square's SUBTOTAL_PHASE percentage service charge: 1.9% of
// the pre-discount subtotal, truncated to whole cents. Square's
// authoritative totalMoney (returned from orders.create) is the source
// of truth for the charged amount — this helper is for pre-order UI
// display only, and is kept in sync with CARD_SURCHARGE_BPS.
export function cardSurcharge(subtotalCents: bigint): bigint {
  if (subtotalCents <= 0n) return 0n;
  return (subtotalCents * CARD_SURCHARGE_BPS) / 10000n;
}

// Mirrors Square's SUBTOTAL_PHASE percentage service charge: 10% of the
// pre-discount subtotal, truncated to whole cents. Only attached server-side
// when /api/orders detects an active QLD public holiday. Square's totalMoney
// remains the authoritative charged amount — this helper is for pre-order
// UI display and Apple/Google Pay sheet pre-compute only.
export function publicHolidaySurcharge(baseCents: bigint): bigint {
  if (baseCents <= 0n) return 0n;
  return (baseCents * PH_SURCHARGE_BPS) / 10000n;
}

// Mirrors Square's SUBTOTAL_PHASE percentage service charge: 0.5% of the
// pre-discount subtotal, truncated to whole cents. UI-display only — Square's
// totalMoney is the authoritative charged amount; ≤1c divergence may exist
// at certain price points due to Square's round-half-up vs. BigInt floor.
export function platformFee(subtotalCents: bigint): bigint {
  if (subtotalCents <= 0n) return 0n;
  return (subtotalCents * PLATFORM_FEE_BPS) / 10000n;
}
