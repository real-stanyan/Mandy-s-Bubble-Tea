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
import { isLockedToppingName, lockedModifierIds } from "@/lib/menu/top10-presets";
import { cappedDistinctCount, isUncountedTopping } from "@/lib/menu/topping-rules";
import { useItemModalClose } from "@/components/menu/ItemModalContext";
import { CupPreview } from "@/components/menu/CupPreview";
import { resolveCupVisual } from "@/lib/menu/cup-visual";

type Props = {
  item: MenuItem;
  modifierLists: ModifierList[];
  /** Topping names locked-on for this view (TOP 10 only). Default none. */
  lockedToppings?: string[];
  /** Customer-facing name override used as the cart line label. */
  displayName?: string;
  /**
   * Pin the cup preview to the top of the scroll container so it stays in
   * view while the customer scrolls the modifier lists — the drop animation
   * is pointless off-screen. Only the item modal turns this on: it owns its
   * scroll container, so `sticky top-0` is exact. The full-route page sits
   * under the mobile app bar (z-40, safe-area-dependent height), where a
   * hardcoded offset would either clip or float.
   */
  stickyPreview?: boolean;
};

type CountMap = Record<string, Record<string, number>>;

const EXCLUSIVE_TOPPINGS = ["Cheese Cream", "Brulee"];
const WARM_ICE_NAME = "warm";

function isExclusiveModifier(mod: ModifierOption): boolean {
  return EXCLUSIVE_TOPPINGS.includes(mod.name);
}

function isWarmIceModifier(mod: ModifierOption): boolean {
  return mod.name.trim().toLowerCase() === WARM_ICE_NAME;
}

function someSelectedAcrossLists(
  counts: CountMap,
  modifierLists: ModifierList[],
  predicate: (mod: ModifierOption) => boolean,
): boolean {
  for (const ml of modifierLists) {
    const map = counts[ml.id];
    if (!map) continue;
    for (const mod of ml.modifiers) {
      if ((map[mod.id] ?? 0) > 0 && predicate(mod)) return true;
    }
  }
  return false;
}

function supportsMultiCount(list: ModifierList): boolean {
  // Single-select lists stay 0-or-1 per modifier. Exclusivity on
  // individual modifiers (Cheese Cream / Brulee) is enforced per-modifier
  // by isExclusiveModifier — it does not disqualify the whole list.
  return list.maxSelected !== 1;
}

function totalInList(counts: CountMap, listId: string): number {
  const map = counts[listId];
  if (!map) return 0;
  let sum = 0;
  for (const v of Object.values(map)) sum += v;
  return sum;
}

function countOf(counts: CountMap, listId: string, modId: string): number {
  return counts[listId]?.[modId] ?? 0;
}

export function ItemOrderForm({
  item,
  modifierLists,
  lockedToppings = [],
  displayName,
  stickyPreview = false,
}: Props) {
  const addLine = useCart((s) => s.addLine);
  // Non-null only when rendered inside the item modal — dismiss it after a
  // successful add so the shopper returns to the menu (the full-route page has
  // no provider, so add-to-cart stays put there).
  const closeModal = useItemModalClose();

  const [variationId, setVariationId] = useState<string>(
    (item.variations.find((v) => !v.soldOut) ?? item.variations[0])?.id ?? "",
  );

  const [selectedByList, setSelectedByList] = useState<CountMap>(() =>
    buildDefaults(modifierLists, lockedToppings),
  );

  const [quantity, setQuantity] = useState(1);

  const isLocked = (mod: ModifierOption) =>
    isLockedToppingName(mod.name, lockedToppings);

  const selectedVariation: ItemVariation | undefined = item.variations.find(
    (v) => v.id === variationId,
  );

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const ml of modifierLists) {
      const picked = totalInList(selectedByList, ml.id);
      // Oreo is exempt from the "different toppings" cap (and unlimited), so
      // it must not count toward maxDistinct.
      const distinct = cappedDistinctCount(ml.modifiers, selectedByList[ml.id] ?? {});
      if (picked < ml.minSelected) {
        errors[ml.id] =
          ml.minSelected === 1
            ? "Please pick one"
            : `Please pick at least ${ml.minSelected}`;
      } else if (ml.maxSelected != null && picked > ml.maxSelected) {
        errors[ml.id] = `Pick no more than ${ml.maxSelected}`;
      } else if (ml.maxDistinct != null && distinct > ml.maxDistinct) {
        errors[ml.id] = `Pick no more than ${ml.maxDistinct} different options`;
      }
    }
    return errors;
  }, [modifierLists, selectedByList]);

  // Names of every currently-selected modifier that's sold out — includes
  // TOP 10 locked toppings, which are auto-selected by buildDefaults() and
  // can't be removed by the customer. Surfaced below so a disabled Add to
  // Cart button always comes with an explanation instead of just going dead.
  const soldOutSelectedNames = useMemo(() => {
    const names: string[] = [];
    for (const ml of modifierLists) {
      const map = selectedByList[ml.id];
      if (!map) continue;
      for (const [modId, count] of Object.entries(map)) {
        if (count <= 0) continue;
        const mod = ml.modifiers.find((m) => m.id === modId);
        if (mod?.soldOut) names.push(mod.name);
      }
    }
    return Array.from(new Set(names));
  }, [modifierLists, selectedByList]);

  const canAdd =
    selectedVariation != null &&
    !selectedVariation.soldOut &&
    soldOutSelectedNames.length === 0 &&
    Object.keys(validationErrors).length === 0;

  const unitPriceCents = useMemo(() => {
    if (!selectedVariation?.priceCents) return 0n;
    let total = selectedVariation.priceCents;
    for (const ml of modifierLists) {
      const map = selectedByList[ml.id];
      if (!map) continue;
      for (const mod of ml.modifiers) {
        const count = map[mod.id] ?? 0;
        if (count > 0 && mod.priceCents) {
          total += mod.priceCents * BigInt(count);
        }
      }
    }
    return total;
  }, [selectedVariation, modifierLists, selectedByList]);

  const totalCents = unitPriceCents * BigInt(quantity);

  // Everything currently switched on, flattened across lists — the cup only
  // cares what was picked, not which list it came from. Sugar, ice, size and
  // the "Standard (Recommended)" default all ride along and are ignored by
  // whatever the mapper doesn't recognise.
  const cupVisual = useMemo(
    () =>
      resolveCupVisual({
        drinkName: displayName ?? item.name,
        picked: modifierLists.flatMap((ml) =>
          ml.modifiers.map((mod) => ({
            name: mod.name,
            count: countOf(selectedByList, ml.id, mod.id),
          })),
        ),
      }),
    [displayName, item.name, modifierLists, selectedByList],
  );

  function getExclusivePartner(
    list: ModifierList,
    modifierId: string,
  ): string | null {
    const mod = list.modifiers.find((m) => m.id === modifierId);
    if (!mod || !isExclusiveModifier(mod)) return null;
    const partner = list.modifiers.find(
      (m) => m.id !== modifierId && isExclusiveModifier(m),
    );
    return partner?.id ?? null;
  }

  function canIncrement(list: ModifierList, modifierId: string): boolean {
    const mod = list.modifiers.find((m) => m.id === modifierId);
    if (!mod || mod.soldOut) return false;
    const current = countOf(selectedByList, list.id, modifierId);
    // Cross-list mutex: Warm ice ⊥ Cheese Cream / Brulee toppings.
    // Hot drinks don't pair with cold cream / torched-sugar toppings.
    if (
      isWarmIceModifier(mod) &&
      someSelectedAcrossLists(selectedByList, modifierLists, isExclusiveModifier)
    ) {
      return false;
    }
    if (
      isExclusiveModifier(mod) &&
      someSelectedAcrossLists(selectedByList, modifierLists, isWarmIceModifier)
    ) {
      return false;
    }
    // Single-select list (maxSelected=1 overall)
    if (list.maxSelected === 1) {
      return current < 1;
    }
    // Exclusive modifier (Cheese Cream / Brulee): stackable on their own,
    // but mutually exclusive with the partner option.
    if (isExclusiveModifier(mod)) {
      const partnerId = getExclusivePartner(list, modifierId);
      if (partnerId && countOf(selectedByList, list.id, partnerId) > 0)
        return false;
    }
    // Oreo is exempt: unlimited quantity and never counted toward the
    // "different toppings" cap. Skip both caps for it.
    const uncounted = isUncountedTopping(mod.name);
    // Distinct-kind cap: adding a brand new option would exceed the
    // "different kinds" limit. Bumping an already-picked option is fine.
    // Oreo neither counts toward nor is blocked by this cap.
    if (
      !uncounted &&
      list.maxDistinct != null &&
      current === 0 &&
      cappedDistinctCount(list.modifiers, selectedByList[list.id] ?? {}) >=
        list.maxDistinct
    ) {
      return false;
    }
    // Per-kind cap: each modifier can only be stacked up to this count.
    if (!uncounted && list.maxPerKind != null && current >= list.maxPerKind) {
      return false;
    }
    // Bound by list-total maxSelected if set
    if (list.maxSelected != null) {
      return totalInList(selectedByList, list.id) < list.maxSelected;
    }
    return true;
  }

  function incrementModifier(list: ModifierList, modifierId: string) {
    if (!canIncrement(list, modifierId)) return;
    setSelectedByList((prev) => {
      const listMap = { ...(prev[list.id] ?? {}) };
      // Single-select: clear others
      if (list.maxSelected === 1) {
        for (const k of Object.keys(listMap)) listMap[k] = 0;
      }
      // Exclusive: clear partner
      const partnerId = getExclusivePartner(list, modifierId);
      if (partnerId) listMap[partnerId] = 0;
      listMap[modifierId] = (listMap[modifierId] ?? 0) + 1;
      return { ...prev, [list.id]: listMap };
    });
  }

  function decrementModifier(list: ModifierList, modifierId: string) {
    setSelectedByList((prev) => {
      const listMap = { ...(prev[list.id] ?? {}) };
      const current = listMap[modifierId] ?? 0;
      if (current <= 0) return prev;
      const mod = list.modifiers.find((m) => m.id === modifierId);
      // TOP 10 locked toppings cannot be removed — floor at 1.
      if (mod && isLocked(mod) && current <= 1) return prev;
      listMap[modifierId] = current - 1;
      return { ...prev, [list.id]: listMap };
    });
  }

  function handleAdd() {
    if (!canAdd || !selectedVariation) return;
    const chosenModifiers = modifierLists.flatMap((ml) => {
      const map = selectedByList[ml.id];
      if (!map) return [];
      return ml.modifiers.flatMap((m) => {
        const count = map[m.id] ?? 0;
        if (count <= 0) return [];
        return Array.from({ length: count }, () => ({
          id: m.id,
          name: m.name,
          priceCents: m.priceCents ?? 0n,
        }));
      });
    });

    addLine(
      {
        itemId: item.id,
        itemName: displayName ?? item.name,
        itemImageUrl: item.imageUrl,
        variationId: selectedVariation.id,
        variationName: selectedVariation.name,
        variationPriceCents: selectedVariation.priceCents ?? 0n,
        modifiers: chosenModifiers,
      },
      quantity,
    );

    setSelectedByList(buildDefaults(modifierLists, lockedToppings));
    setQuantity(1);

    // Inside the modal: dismiss it so the shopper drops back to the menu.
    closeModal?.();
  }

  return (
    <div>
      <div
        className={
          stickyPreview
            ? // Solid background + shadow because form content scrolls
              // underneath while it's stuck. Opaque, not translucent — text
              // ghosting through the cup reads as a rendering bug.
              "sticky top-0 z-10 -mx-1 mb-6 rounded-card border border-line bg-card px-4 py-3 shadow-[0_10px_28px_rgba(42,30,20,0.12)]"
            : "mb-6 rounded-card border border-line bg-bg2/60 p-4"
        }
      >
        <CupPreview visual={cupVisual} drinkName={displayName ?? item.name} />
      </div>

      <Section title="Size">
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-zinc-50 px-4 py-2.5 text-sm font-medium text-zinc-400">
            Large 700ml
          </span>
        </div>
      </Section>

      {item.variations.length > 1 && (
        <Section title="Select Size">
          <div className="flex flex-wrap gap-2">
            {item.variations.map((v) => {
              const active = variationId === v.id;
              const disabled = v.soldOut && !active;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    if (v.soldOut) return;
                    setVariationId(v.id);
                  }}
                  disabled={disabled}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition ${
                    active
                      ? "border-transparent text-white"
                      : disabled
                        ? "cursor-not-allowed border-black/5 bg-zinc-50 text-zinc-300"
                        : "border-black/10 bg-white text-zinc-700 hover:bg-black/5"
                  }`}
                  style={
                    active ? { backgroundColor: "#3E2723" } : undefined
                  }
                >
                  {v.name}
                  {v.soldOut && (
                    <span className="text-xs font-normal">(Sold out)</span>
                  )}
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {modifierLists.map((ml) => {
        const multi = supportsMultiCount(ml);
        return (
          <Section
            key={ml.id}
            title={ml.name}
            hint={describeSelection(ml, multi)}
            error={validationErrors[ml.id]}
          >
            <div className="flex flex-wrap gap-2">
              {ml.modifiers.map((mod) => {
                const count = countOf(selectedByList, ml.id, mod.id);
                const modCanMulti = multi;
                if (modCanMulti && count > 0) {
                  const locked = isLocked(mod);
                  return (
                    <ModifierStepper
                      key={mod.id}
                      label={mod.name}
                      count={count}
                      priceText={priceLabel(mod)}
                      locked={locked}
                      soldOut={mod.soldOut}
                      canIncrement={canIncrement(ml, mod.id)}
                      canDecrement={!(locked && count <= 1)}
                      onIncrement={() => incrementModifier(ml, mod.id)}
                      onDecrement={() => decrementModifier(ml, mod.id)}
                    />
                  );
                }
                const selected = count > 0;
                const locked = isLocked(mod);
                const disabled =
                  mod.soldOut ||
                  locked ||
                  (!selected && !canIncrement(ml, mod.id));
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => {
                      if (locked) return; // locked = non-removable
                      if (selected && !modCanMulti) {
                        decrementModifier(ml, mod.id);
                      } else if (!selected) {
                        incrementModifier(ml, mod.id);
                      }
                    }}
                    disabled={disabled}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition ${
                      selected || locked
                        ? "border-transparent text-white"
                        : disabled
                          ? "cursor-not-allowed border-black/5 bg-zinc-50 text-zinc-300"
                          : "border-black/10 bg-white text-zinc-700 hover:bg-black/5"
                    }`}
                    style={
                      selected || locked
                        ? { backgroundColor: BRAND.primaryColor }
                        : undefined
                    }
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={selected || locked ? "" : "invisible"}
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {mod.name}
                    {locked && (
                      <span className="ml-1 rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                        Included
                      </span>
                    )}
                    {mod.soldOut && (
                      <span className="text-xs font-normal">(Sold out)</span>
                    )}
                    {priceLabel(mod) && (
                      <span
                        className={
                          selected
                            ? "opacity-80"
                            : disabled
                              ? "text-zinc-300"
                              : "text-zinc-400"
                        }
                      >
                        {priceLabel(mod)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </Section>
        );
      })}

      {soldOutSelectedNames.length > 0 && (
        <p
          role="alert"
          className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
        >
          {soldOutSelectedNames.join(", ")}{" "}
          {soldOutSelectedNames.length === 1 ? "is" : "are"} sold out right
          now, so this item can&apos;t be added as configured. Check back
          later, or pick it from its regular category to customize toppings.
        </p>
      )}

      <div className="mt-6 flex items-center gap-3 sm:mt-8">
        <QuantityStepper value={quantity} onChange={setQuantity} />

        <button
          type="button"
          onClick={handleAdd}
          disabled={!canAdd}
          className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 py-3.5 text-sm font-semibold text-white transition ${
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

function ModifierStepper({
  label,
  count,
  priceText,
  locked = false,
  soldOut = false,
  canIncrement,
  canDecrement = true,
  onIncrement,
  onDecrement,
}: {
  label: string;
  count: number;
  priceText: string;
  locked?: boolean;
  soldOut?: boolean;
  canIncrement: boolean;
  canDecrement?: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border border-transparent pl-1 pr-3 py-1 text-sm font-medium text-white"
      style={{ backgroundColor: soldOut ? "#b91c1c" : BRAND.primaryColor }}
    >
      <button
        type="button"
        onClick={onDecrement}
        disabled={!canDecrement}
        aria-label={`Decrease ${label}`}
        className="flex h-7 w-7 items-center justify-center rounded-full text-base text-white/90 transition hover:bg-white/15 active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        −
      </button>
      <span className="px-1">
        {label}
        {count > 1 && <span className="ml-1 text-white/85">× {count}</span>}
        {locked && (
          <span className="ml-1 rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
            Included
          </span>
        )}
        {soldOut && <span className="ml-1 text-xs font-normal">(Sold out)</span>}
      </span>
      <button
        type="button"
        onClick={onIncrement}
        disabled={!canIncrement}
        aria-label={`Increase ${label}`}
        className="flex h-7 w-7 items-center justify-center rounded-full text-base text-white/90 transition hover:bg-white/15 active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        +
      </button>
      {priceText && <span className="opacity-80">{priceText}</span>}
    </div>
  );
}

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
        {hint && <span className="text-xs text-zinc-400">{hint}</span>}
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

function describeSelection(ml: ModifierList, multi: boolean): string {
  const { minSelected, maxSelected, maxDistinct, maxPerKind } = ml;
  if (minSelected === 0 && maxSelected === 1) return "Pick one (optional)";
  if (minSelected === 1 && maxSelected === 1) return "Pick one";
  // Oreo is exempt from the cap — surface that when this list offers it.
  const oreoFree = ml.modifiers.some((m) => isUncountedTopping(m.name))
    ? " · Oreo unlimited (doesn't count)"
    : "";
  if (multi) {
    if (maxDistinct != null && maxPerKind != null) {
      return `Up to ${maxDistinct} kinds · max ${maxPerKind} of each${oreoFree}`;
    }
    if (maxDistinct != null) {
      return `Up to ${maxDistinct} kinds · tap + for more of each${oreoFree}`;
    }
    if (maxSelected == null && minSelected === 0) return "Tap to add · tap + for more";
    if (maxSelected == null && minSelected > 0)
      return `At least ${minSelected} · tap + for more`;
    if (minSelected === 0) return `Up to ${maxSelected} total · tap + for more`;
    return `Pick ${minSelected}–${maxSelected} total`;
  }
  if (maxSelected == null && minSelected === 0) return "Pick any";
  if (maxSelected == null && minSelected > 0)
    return `Pick at least ${minSelected}`;
  if (minSelected === 0) return `Pick up to ${maxSelected}`;
  return `Pick ${minSelected}–${maxSelected}`;
}

function buildDefaults(
  modifierLists: ModifierList[],
  lockedToppings: string[] = [],
): CountMap {
  const initial: CountMap = {};
  for (const ml of modifierLists) {
    const defaults = ml.modifiers.filter((m) => m.onByDefault);
    if (defaults.length > 0) {
      const map: Record<string, number> = {};
      for (const m of defaults) map[m.id] = 1;
      initial[ml.id] = map;
    }
  }
  // Seed TOP 10 locked toppings to count 1 (on top of Square onByDefault).
  for (const { listId, modifierId } of lockedModifierIds(modifierLists, lockedToppings)) {
    const map = initial[listId] ?? {};
    if ((map[modifierId] ?? 0) < 1) map[modifierId] = 1;
    initial[listId] = map;
  }
  return initial;
}
