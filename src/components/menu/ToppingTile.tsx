"use client";

import { useState } from "react";
import { ToppingGlyph } from "@/components/menu/ToppingGlyph";
import { formatPrice } from "@/lib/utils";
import type { ToppingIdentity } from "@/lib/menu/topping-identity";

// One topping, as a tile: its own glyph, its own colour on the border and
// a wash of it behind when picked, the price — and the price gives way to
// a stepper once it is in the cup. When it cannot be picked the tile dims
// and says why (sold out, the three-topping cap, not with Warm), instead
// of just refusing. Port of the App's components/menu/ToppingTile.tsx.

type Props = {
  name: string;
  priceCents: bigint | number | null;
  identity: ToppingIdentity;
  count: number;
  /** Top 10 build: this topping is part of the drink and cannot be removed. */
  locked: boolean;
  soldOut: boolean;
  /** Cannot be added right now (count is 0). */
  disabled: boolean;
  disabledReason?: string | null;
  supportsStepper: boolean;
  canIncrement: boolean;
  canDecrement: boolean;
  onToggle: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
};

export function ToppingTile({
  name,
  priceCents,
  identity,
  count,
  locked,
  soldOut,
  disabled,
  disabledReason,
  supportsStepper,
  canIncrement,
  canDecrement,
  onToggle,
  onIncrement,
  onDecrement,
}: Props) {
  const selected = count > 0;
  // Once it is in the cup the price gives way to − n +; a locked (Top 10)
  // topping keeps the stepper too, its minus disabled at one by the parent.
  const showStepper = supportsStepper && selected;
  const inert = showStepper || (locked && selected);

  // Settle: the glyph gives a little bounce when the topping lands in the cup.
  // Derived during render (the sanctioned way to react to a prop change):
  // no bounce on first paint, one when it becomes the pick.
  const [settling, setSettling] = useState(false);
  const [wasSelected, setWasSelected] = useState(selected);
  if (selected !== wasSelected) {
    setWasSelected(selected);
    if (selected) setSettling(true);
  }

  const reason = soldOut ? "Sold out" : disabled ? (disabledReason ?? "Unavailable") : null;
  const price = Number(priceCents ?? 0);

  const activate = () => {
    if (inert || disabled) return;
    onToggle();
  };

  return (
    <div
      role="checkbox"
      aria-checked={selected}
      aria-disabled={disabled || inert}
      aria-label={`${name}, ${price > 0 ? formatPrice(price) : "free"}${reason ? `, ${reason}` : ""}`}
      tabIndex={inert ? -1 : 0}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          activate();
        }
      }}
      className={
        "relative flex flex-col gap-1.5 rounded-[18px] border-[1.5px] bg-card p-3 pb-2.5 text-left transition-[transform,border-color,background-color] duration-200 " +
        (disabled && !selected ? "cursor-not-allowed opacity-45 " : inert ? "" : "cursor-pointer active:scale-[0.97] ") +
        (selected ? "" : "border-line")
      }
      style={
        selected
          ? { borderColor: identity.edge, backgroundColor: `color-mix(in oklab, ${identity.edge} 9%, var(--card))` }
          : undefined
      }
    >
      {locked ? (
        <span
          className={
            "absolute right-2.5 top-2.5 rounded-full px-1.5 py-[3px] font-mono text-[8.5px] font-bold tracking-[0.08em] " +
            (soldOut ? "bg-red-700/10 text-[#B5482A]" : "bg-ink/[0.08] text-ink2")
          }
        >
          {soldOut ? "INCLUDED · SOLD OUT" : "INCLUDED"}
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="absolute right-2.5 top-2.5 grid h-[22px] w-[22px] place-items-center rounded-full border-[1.5px] border-line text-white"
          style={selected ? { backgroundColor: identity.edge, borderColor: identity.edge } : undefined}
        >
          {selected && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7" />
            </svg>
          )}
        </span>
      )}

      <div
        className={"mt-0.5 h-11 w-11 " + (settling ? "mbt-settle" : "")}
        onAnimationEnd={() => setSettling(false)}
      >
        <ToppingGlyph identity={identity} size={44} />
      </div>

      <p className="min-h-[34px] text-[13.5px] font-semibold leading-[17px] text-ink" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {name}
      </p>

      <div className="flex min-h-[26px] items-center justify-between gap-1.5">
        {reason ? (
          <span className={"truncate text-[11.5px] font-semibold " + (soldOut ? "text-[#B5482A]" : "text-ink3")}>{reason}</span>
        ) : showStepper ? (
          <span
            className="flex h-[26px] items-center gap-2 rounded-full border border-line bg-bg px-1"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onDecrement}
              disabled={!canDecrement}
              aria-label={`Decrease ${name}`}
              className="grid h-5 w-5 place-items-center rounded-full bg-card text-[14px] font-bold leading-none text-ink transition hover:bg-bg2 disabled:cursor-not-allowed disabled:opacity-35"
            >
              −
            </button>
            <span className="min-w-[12px] text-center font-mono text-[12px] font-bold text-ink">{count}</span>
            <button
              type="button"
              onClick={onIncrement}
              disabled={!canIncrement}
              aria-label={`Increase ${name}`}
              className="grid h-5 w-5 place-items-center rounded-full bg-card text-[14px] font-bold leading-none text-ink transition hover:bg-bg2 disabled:cursor-not-allowed disabled:opacity-35"
            >
              +
            </button>
          </span>
        ) : (
          <span className="font-mono text-[11.5px] font-bold text-ink3">{price > 0 ? `+${formatPrice(price)}` : "Free"}</span>
        )}
      </div>
    </div>
  );
}

/** Group header for a run of tiles: a colour dot, the texture, how many are in the cup. */
export function ToppingGroupHead({ label, color, picked }: { label: string; color: string; picked: number }) {
  return (
    <div className="mb-2 mt-3.5 flex items-center gap-2">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-ink3">{label}</span>
      {picked > 0 && <span className="text-[11.5px] font-medium text-ink3">{picked} in the cup</span>}
    </div>
  );
}
