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

// Interactive order form for a single item: variation + modifier lists
// + quantity + add-to-cart. Renders nothing on the server (purely client)
// to avoid hydration mismatches around the cart store.

type Props = {
  item: MenuItem;
  modifierLists: ModifierList[];
};

export function ItemOrderForm({ item, modifierLists }: Props) {
  const addLine = useCart((s) => s.addLine);

  // Default-select the first variation.
  const [variationId, setVariationId] = useState<string>(
    item.variations[0]?.id ?? "",
  );

  // modifierListId → set of selected modifier ids
  const [selectedByList, setSelectedByList] = useState<
    Record<string, Set<string>>
  >({});

  const [quantity, setQuantity] = useState(1);

  const selectedVariation: ItemVariation | undefined = item.variations.find(
    (v) => v.id === variationId,
  );

  // Validation: each modifier list must satisfy its selection bounds.
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

  // Live total (unit × quantity).
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

    addLine({
      itemId: item.id,
      itemName: item.name,
      itemImageUrl: item.imageUrl,
      variationId: selectedVariation.id,
      variationName: selectedVariation.name,
      variationPriceCents: selectedVariation.priceCents ?? 0n,
      modifiers: chosenModifiers,
    }, quantity);

    // Reset local form so the next add starts fresh.
    setSelectedByList({});
    setQuantity(1);
  }

  return (
    <div>
      {item.variations.length > 1 && (
        <Section title="Size">
          <div className="divide-y divide-black/5 rounded-md border border-black/10 bg-white">
            {item.variations.map((v) => (
              <label
                key={v.id}
                className="flex cursor-pointer items-center justify-between px-4 py-3"
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="variation"
                    checked={variationId === v.id}
                    onChange={() => setVariationId(v.id)}
                    className="accent-current"
                    style={{ accentColor: BRAND.primaryColor }}
                  />
                  <span className="text-sm text-zinc-800">{v.name}</span>
                </span>
                <span className="text-sm font-medium text-zinc-600">
                  {v.priceCents != null ? formatPrice(v.priceCents) : "—"}
                </span>
              </label>
            ))}
          </div>
        </Section>
      )}

      {modifierLists.map((ml) => (
        <Section
          key={ml.id}
          title={ml.name}
          hint={describeSelection(ml)}
          error={validationErrors[ml.id]}
        >
          <ModifierOptions
            list={ml}
            selected={selectedByList[ml.id] ?? new Set()}
            onToggle={(modId) => toggleModifier(ml, modId)}
          />
        </Section>
      ))}

      {/* Quantity + add to cart */}
      <div className="mt-8 border-t border-black/10 pt-6">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-700">Quantity</span>
          <QuantityStepper value={quantity} onChange={setQuantity} />
        </div>

        <button
          type="button"
          onClick={handleAdd}
          disabled={!canAdd}
          className={`flex w-full items-center justify-between rounded-full px-6 py-3 text-white transition ${
            canAdd
              ? "hover:opacity-90"
              : "cursor-not-allowed opacity-50"
          }`}
          style={{ backgroundColor: BRAND.primaryColor }}
        >
          <span className="font-semibold">Add to cart</span>
          <span className="font-semibold">{formatPrice(totalCents)}</span>
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
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
        {hint && (
          <span className="text-xs uppercase tracking-wide text-zinc-500">
            {hint}
          </span>
        )}
      </div>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </section>
  );
}

function ModifierOptions({
  list,
  selected,
  onToggle,
}: {
  list: ModifierList;
  selected: Set<string>;
  onToggle: (modifierId: string) => void;
}) {
  if (list.modifiers.length === 0) {
    return (
      <p className="text-sm italic text-zinc-400">No options available.</p>
    );
  }
  const isSingleSelect = list.maxSelected === 1;
  return (
    <ul className="divide-y divide-black/5 rounded-md border border-black/10 bg-white">
      {list.modifiers.map((mod) => (
        <li key={mod.id}>
          <label className="flex cursor-pointer items-center justify-between px-4 py-3">
            <span className="flex items-center gap-3">
              <input
                type={isSingleSelect ? "radio" : "checkbox"}
                name={`modlist-${list.id}`}
                checked={selected.has(mod.id)}
                onChange={() => onToggle(mod.id)}
                style={{ accentColor: BRAND.primaryColor }}
              />
              <span className="text-sm text-zinc-800">{mod.name}</span>
            </span>
            <span className="text-sm font-medium text-zinc-600">
              {priceLabel(mod)}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function priceLabel(mod: ModifierOption): string {
  if (mod.priceCents == null || mod.priceCents === 0n) return "";
  return `+${formatPrice(mod.priceCents)}`;
}

function QuantityStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (q: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-black/10">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, value - 1))}
        aria-label="Decrease quantity"
        className="h-8 w-8 rounded-l-full text-sm hover:bg-black/5"
      >
        −
      </button>
      <span className="w-6 text-center text-sm font-medium">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        aria-label="Increase quantity"
        className="h-8 w-8 rounded-r-full text-sm hover:bg-black/5"
      >
        +
      </button>
    </div>
  );
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
