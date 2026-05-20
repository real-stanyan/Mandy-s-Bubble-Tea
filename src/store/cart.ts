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

type CartState = {
  lines: CartLine[];
  isOpen: boolean;
  hydrated: boolean;

  // Per-cup gallery-label selection. Key = cupKey (`${lineId}::${cupIdx}`,
  // 0-indexed), value = gallery hash from public/cup-label/gallery/.
  labelSelections: Record<string, string>;

  // Actions
  addLine: (line: Omit<CartLine, "id" | "quantity">, quantity?: number) => void;
  setQuantity: (lineId: string, quantity: number) => void;
  removeLine: (lineId: string) => void;
  clear: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  setLabel: (cupKey: string, galleryHash: string) => void;
  clearLabel: (cupKey: string) => void;
};

/** Build the deterministic key for a single cup within a cart line. */
export function cupKey(lineId: string, cupIdx: number): string {
  return `${lineId}::${cupIdx}`;
}

/** Drop every selection belonging to a removed line. */
function pruneSelectionsForLine(
  selections: Record<string, string>,
  lineId: string,
): Record<string, string> {
  const prefix = `${lineId}::`;
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(selections)) {
    if (!k.startsWith(prefix)) next[k] = v;
  }
  return next;
}

/** Drop selections for cup indices that no longer exist after a qty cut. */
function pruneSelectionsAboveCup(
  selections: Record<string, string>,
  lineId: string,
  maxQty: number,
): Record<string, string> {
  const prefix = `${lineId}::`;
  const next: Record<string, string> = {};
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

/** Compute a signature that groups line items with identical contents. */
function signatureFor(
  itemId: string,
  variationId: string,
  modifiers: CartLineModifier[],
): string {
  const modIds = modifiers
    .map((m) => m.id)
    .sort()
    .join("|");
  return `${itemId}::${variationId}::${modIds}`;
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      isOpen: false,
      hydrated: false,
      labelSelections: {},

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

      clear: () => set({ lines: [], labelSelections: {} }),
      openDrawer: () => set({ isOpen: true }),
      closeDrawer: () => set({ isOpen: false }),
      setLabel: (key, galleryHash) =>
        set((state) => ({
          labelSelections: { ...state.labelSelections, [key]: galleryHash },
        })),
      clearLabel: (key) =>
        set((state) => {
          const next = { ...state.labelSelections };
          delete next[key];
          return { labelSelections: next };
        }),
    }),
    {
      name: "mandy-cart",
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
      // Don't persist drawer open state — always start closed.
      partialize: (state) => ({
        lines: state.lines,
        labelSelections: state.labelSelections,
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
