"use client";

import { useState } from "react";
import { MilkGlyph } from "@/components/menu/MilkGlyph";
import { formatPrice } from "@/lib/utils";
import { MILK_KIND_LABEL, milkDisplayName, type MilkIdentity } from "@/lib/menu/milk-identity";

// One milk, as a card in a horizontal strip: its glyph, its name, the price
// (or "Included"), a check when picked, and a RECOMMENDED ribbon on the
// house default. Single choice, so picking one is a radio, not a toggle —
// the parent moves the selection; a click on the picked card does nothing.
// Port of the App's components/menu/MilkCard.tsx.

type CardProps = {
  name: string;
  priceCents: bigint | number | null;
  identity: MilkIdentity;
  selected: boolean;
  soldOut: boolean;
  /** Cannot be picked right now. */
  disabled: boolean;
  onPick: () => void;
};

export function MilkCard({ name, priceCents, identity, selected, soldOut, disabled, onPick }: CardProps) {
  // Settle: the carton gives a little bounce when it becomes the pick.
  // Derived during render (the sanctioned way to react to a prop change):
  // no bounce on first paint, one when it becomes the pick.
  const [settling, setSettling] = useState(false);
  const [wasSelected, setWasSelected] = useState(selected);
  if (selected !== wasSelected) {
    setWasSelected(selected);
    if (selected) setSettling(true);
  }

  const label = milkDisplayName(name);
  const price = Number(priceCents ?? 0);
  const priceText = soldOut ? "Sold out" : price > 0 ? `+${formatPrice(price)}` : "Included";

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      aria-label={`${label}, ${priceText}${identity.recommended ? ", recommended" : ""}`}
      onClick={() => {
        if (selected || disabled) return;
        onPick();
      }}
      className={
        "relative flex w-24 shrink-0 snap-start flex-col items-center gap-[5px] rounded-2xl border-[1.5px] bg-card px-2 pb-2 pt-2.5 text-center transition-[transform,border-color,background-color] duration-200 " +
        (disabled && !selected ? "cursor-not-allowed opacity-45 " : selected ? "cursor-default " : "cursor-pointer hover:border-ink4 active:scale-[0.96] ") +
        (selected ? "" : "border-line")
      }
      style={
        selected
          ? { borderColor: identity.band, backgroundColor: `color-mix(in oklab, ${identity.band} 12%, var(--card))` }
          : undefined
      }
    >
      {identity.recommended && (
        <span className="absolute -top-[7px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-brand px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-[0.08em] text-white">
          RECOMMENDED
        </span>
      )}
      <span
        aria-hidden="true"
        className="absolute right-[7px] top-[7px] grid h-[18px] w-[18px] place-items-center rounded-full border-[1.5px] border-line text-white"
        style={selected ? { backgroundColor: identity.band, borderColor: identity.band } : undefined}
      >
        {selected && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7" />
          </svg>
        )}
      </span>
      <span className={"h-[38px] w-[38px] " + (settling ? "mbt-settle" : "")} onAnimationEnd={() => setSettling(false)}>
        <MilkGlyph identity={identity} size={38} />
      </span>
      <span className="min-h-[28px] text-[12px] font-semibold leading-[14px] text-ink">{label}</span>
      <span className={"font-mono text-[10.5px] font-bold " + (soldOut ? "text-[#B5482A]" : "text-ink3")}>{priceText}</span>
    </button>
  );
}

/** The picked milk explained: what it is, and what it costs. */
export function MilkDetail({ name, priceCents, identity }: { name: string; priceCents: bigint | number | null; identity: MilkIdentity }) {
  const price = Number(priceCents ?? 0);
  const blurb = identity.blurb || MILK_KIND_LABEL[identity.kind];
  return (
    <div aria-live="polite" className="mt-2.5 flex items-center gap-2.5 rounded-[14px] border border-line bg-bg px-3 py-2">
      <MilkGlyph identity={identity} size={26} className="shrink-0" />
      <div className="min-w-0">
        <p className="truncate text-[12.5px] font-semibold text-ink">
          {milkDisplayName(name)} · {price > 0 ? `+${formatPrice(price)}` : "Included"}
        </p>
        {blurb && <p className="text-[11.5px] leading-[15px] text-ink3">{blurb}</p>}
      </div>
    </div>
  );
}
