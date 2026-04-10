"use client";

import { useMemo, useState } from "react";
import { formatPrice } from "@/lib/utils";
import { BRAND } from "@/lib/constants";
import type {
  ItemVariation,
  MenuItem,
  ModifierList,
  ModifierOption,
} from "@/lib/catalog";
import { useCart } from "@/store/cart";

type Props = {
  item: MenuItem;
  modifierLists: ModifierList[];
};

export function ItemOrderForm({ item, modifierLists }: Props) {
  const addLine = useCart((s) => s.addLine);

  const [variationId, setVariationId] = useState<string>(
    item.variations[0]?.id ?? "",
  );

  // modifierListId → set of selected modifier ids
  // Initialize from onByDefault flags set in Square Dashboard.
  const [selectedByList, setSelectedByList] = useState<
    Record<string, Set<string>>
  >(() => {
    const initial: Record<string, Set<string>> = {};
    for (const ml of modifierLists) {
      const defaults = ml.modifiers
        .filter((m) => m.onByDefault)
        .map((m) => m.id);
      if (defaults.length > 0) {
        initial[ml.id] = new Set(defaults);
      }
    }
    return initial;
  });

  const [quantity, setQuantity] = useState(1);

  const selectedVariation: ItemVariation | undefined = item.variations.find(
    (v) => v.id === variationId,
  );

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const ml of modifierLists) {
      const picked = selectedByList[ml.id]?.size ?? 0;
      if (picked < ml.minSelected) {
        errors[ml.id] =
          ml.minSelected === 1
            ? "Please pick one"
            : `Please pick at least ${ml.minSelected}`;
      } else if (ml.maxSelected != null && picked > ml.maxSelected) {
        errors[ml.id] = `Pick no more than ${ml.maxSelected}`;
      }
    }
    return errors;
  }, [modifierLists, selectedByList]);

  const canAdd =
    selectedVariation != null && Object.keys(validationErrors).length === 0;

  const unitPriceCents = useMemo(() => {
    if (!selectedVariation?.priceCents) return 0n;
    let total = selectedVariation.priceCents;
    for (const ml of modifierLists) {
      const picks = selectedByList[ml.id] ?? new Set();
      for (const mod of ml.modifiers) {
        if (picks.has(mod.id) && mod.priceCents) {
          total += mod.priceCents;
        }
      }
    }
    return total;
  }, [selectedVariation, modifierLists, selectedByList]);

  const totalCents = unitPriceCents * BigInt(quantity);

  function toggleModifier(list: ModifierList, modifierId: string) {
    setSelectedByList((prev) => {
      const current = new Set(prev[list.id] ?? []);
      const isSingleSelect = list.maxSelected === 1;
      if (current.has(modifierId)) {
        current.delete(modifierId);
      } else {
        if (isSingleSelect) current.clear();
        current.add(modifierId);
      }
      return { ...prev, [list.id]: current };
    });
  }

  function handleAdd() {
    if (!canAdd || !selectedVariation) return;
    const chosenModifiers = modifierLists.flatMap((ml) => {
      const picks = selectedByList[ml.id] ?? new Set();
      return ml.modifiers
        .filter((m) => picks.has(m.id))
        .map((m) => ({
          id: m.id,
          name: m.name,
          priceCents: m.priceCents ?? 0n,
        }));
    });

    addLine(
      {
        itemId: item.id,
        itemName: item.name,
        itemImageUrl: item.imageUrl,
        variationId: selectedVariation.id,
        variationName: selectedVariation.name,
        variationPriceCents: selectedVariation.priceCents ?? 0n,
        modifiers: chosenModifiers,
      },
      quantity,
    );

    // Reset to defaults from Square Dashboard.
    const reset: Record<string, Set<string>> = {};
    for (const ml of modifierLists) {
      const defaults = ml.modifiers
        .filter((m) => m.onByDefault)
        .map((m) => m.id);
      if (defaults.length > 0) {
        reset[ml.id] = new Set(defaults);
      }
    }
    setSelectedByList(reset);
    setQuantity(1);
  }

  return (
    <div>
      {/* Variations — pill toggle */}
      {item.variations.length > 1 && (
        <Section title="Select Size">
          <div className="flex flex-wrap gap-2">
            {item.variations.map((v) => {
              const active = variationId === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVariationId(v.id)}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition ${
                    active
                      ? "border-transparent text-white"
                      : "border-black/10 bg-white text-zinc-700 hover:bg-black/5"
                  }`}
                  style={
                    active ? { backgroundColor: "#3E2723" } : undefined
                  }
                >
                  {v.name}
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {/* Modifier lists — pill selectors */}
      {modifierLists.map((ml) => (
        <Section
          key={ml.id}
          title={ml.name}
          hint={describeSelection(ml)}
          error={validationErrors[ml.id]}
        >
          <div className="flex flex-wrap gap-2">
            {ml.modifiers.map((mod) => {
              const selected = selectedByList[ml.id]?.has(mod.id) ?? false;
              return (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => toggleModifier(ml, mod.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition ${
                    selected
                      ? "border-transparent text-white"
                      : "border-black/10 bg-white text-zinc-700 hover:bg-black/5"
                  }`}
                  style={
                    selected
                      ? { backgroundColor: BRAND.primaryColor }
                      : undefined
                  }
                >
                  {selected && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                  {mod.name}
                  {priceLabel(mod) && (
                    <span className={selected ? "opacity-80" : "text-zinc-400"}>
                      {priceLabel(mod)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Section>
      ))}

      {/* Quantity + Add to Cart */}
      <div className="mt-6 flex items-center gap-3 sm:mt-8">
        <QuantityStepper value={quantity} onChange={setQuantity} />

        <button
          type="button"
          onClick={handleAdd}
          disabled={!canAdd}
          className={`flex flex-1 items-center justify-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold text-white transition ${
            canAdd ? "hover:opacity-90" : "cursor-not-allowed opacity-50"
          }`}
          style={{ backgroundColor: BRAND.primaryColor }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>
          Add to Cart — {formatPrice(totalCents)}
        </button>
      </div>
    </div>
  );
}

// --- Sub-components ---------------------------------------------------------

function Section({
  title,
  hint,
  error,
  children,
}: {
  title: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-2.5 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          {title}
        </h2>
        {hint && (
          <span className="text-xs text-zinc-400">{hint}</span>
        )}
      </div>
      {children}
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </section>
  );
}

function QuantityStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (q: number) => void;
}) {
  return (
    <div className="flex items-center rounded-full border border-black/10 bg-white">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, value - 1))}
        aria-label="Decrease quantity"
        className="flex h-10 w-10 items-center justify-center rounded-l-full text-lg text-zinc-500 hover:bg-black/5"
      >
        −
      </button>
      <span className="w-8 text-center text-sm font-semibold">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        aria-label="Increase quantity"
        className="flex h-10 w-10 items-center justify-center rounded-r-full text-lg text-zinc-500 hover:bg-black/5"
      >
        +
      </button>
    </div>
  );
}

function priceLabel(mod: ModifierOption): string {
  if (mod.priceCents == null || mod.priceCents === 0n) return "";
  return `+${formatPrice(mod.priceCents)}`;
}

function describeSelection(ml: ModifierList): string {
  const { minSelected, maxSelected } = ml;
  if (minSelected === 0 && maxSelected === 1) return "Pick one (optional)";
  if (minSelected === 1 && maxSelected === 1) return "Pick one";
  if (maxSelected == null && minSelected === 0) return "Pick any";
  if (maxSelected == null && minSelected > 0)
    return `Pick at least ${minSelected}`;
  if (minSelected === 0) return `Pick up to ${maxSelected}`;
  return `Pick ${minSelected}–${maxSelected}`;
}
