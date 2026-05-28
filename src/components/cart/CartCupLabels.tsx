"use client";

import { memo } from "react";
import Image from "next/image";
import { useCart, cupKey, type CartLine, type CupLabelSelection } from "@/store/cart";
import { BRAND } from "@/lib/constants";
import { summaryFor } from "@/components/checkout/cup-label-summary";

type CartCupLabelsProps = {
  line: CartLine;
  onPickerOpen: (cupKey: string) => void;
};

export const CartCupLabels = memo(function CartCupLabels({
  line,
  onPickerOpen,
}: CartCupLabelsProps) {
  const labelSelections = useCart((s) => s.labelSelections);

  if (line.quantity < 1) return null;

  const cups = Array.from({ length: line.quantity }, (_, i) => i);

  return (
    <div
      className="mt-2.5 rounded-xl bg-zinc-50/80 p-2"
      aria-label={`Cup labels for ${line.itemName}`}
    >
      <div className="mb-0.5 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        <span aria-hidden="true">🎨</span>
        <span>{cups.length > 1 ? "Cup labels" : "Cup label"}</span>
        <span className="text-zinc-400">· Optional</span>
      </div>
      <p className="mb-1.5 px-1 text-[10px] leading-snug text-zinc-400">
        Leave it for a surprise tarot card 🔮, or tap to choose your own.
      </p>
      <ul className="space-y-1">
        {cups.map((cupIdx) => {
          const key = cupKey(line.id, cupIdx);
          const sel = labelSelections[key];
          return (
            <li key={key}>
              <CupRow
                cupIdx={cupIdx}
                totalCups={line.quantity}
                selection={sel}
                onClick={() => onPickerOpen(key)}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
});

function CupRow({
  cupIdx,
  totalCups,
  selection,
  onClick,
}: {
  cupIdx: number;
  totalCups: number;
  selection: CupLabelSelection | undefined;
  onClick: () => void;
}) {
  const showCupNo = totalCups > 1;
  const label = summaryFor(selection);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-2.5 rounded-lg bg-white px-2 py-1.5 text-left ring-1 ring-black/5 transition hover:ring-black/20 focus:outline-none focus-visible:ring-2 active:scale-[0.99]"
      style={
        {
          // tint the focus-visible ring with the brand color
          ["--tw-ring-color" as never]: BRAND.primaryColor,
        } as React.CSSProperties
      }
      aria-label={
        showCupNo
          ? `Edit cup ${cupIdx + 1} of ${totalCups} label · ${label}`
          : `Edit cup label · ${label}`
      }
    >
      <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md ring-1 ring-black/5 bg-white">
        <Thumb selection={selection} />
        <span
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-[10px] text-white opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100"
          aria-hidden="true"
        >
          ✏️
        </span>
      </span>

      <span className="min-w-0 flex-1">
        {showCupNo && (
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Cup {cupIdx + 1} of {totalCups}
          </span>
        )}
        <span className="block truncate text-xs font-medium text-zinc-700">
          {label}
        </span>
      </span>

      <span
        className="shrink-0 text-[10px] font-semibold opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ color: BRAND.primaryColor }}
        aria-hidden="true"
      >
        Change →
      </span>
    </button>
  );
}

function Thumb({ selection }: { selection: CupLabelSelection | undefined }) {
  if (!selection) {
    return (
      <span className="flex h-full w-full items-center justify-center bg-zinc-50 text-base">
        🔮
      </span>
    );
  }
  if (selection.kind === "preset") {
    return (
      <Image
        src={`/cup-label/gallery/${selection.hash}/binarized.png`}
        alt=""
        fill
        sizes="44px"
        unoptimized
        className="object-contain p-0.5"
      />
    );
  }
  if (selection.kind === "photo") {
    return (
      <Image
        src={selection.previewUrl}
        alt="Your photo"
        fill
        sizes="44px"
        unoptimized
        className="object-cover"
      />
    );
  }
  if (selection.kind === "draw") {
    return (
      <span className="flex h-full w-full items-center justify-center bg-zinc-50 text-base">
        ✏️
      </span>
    );
  }
  // kind === "ai"
  return (
    <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-amber-50 to-rose-50 text-base">
      ✨
    </span>
  );
}
