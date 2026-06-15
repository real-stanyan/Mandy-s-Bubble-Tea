"use client";

import { useState } from "react";
import Image from "next/image";
import { useCart, cupKey, type CupLabelSelection } from "@/store/cart";
import { BRAND } from "@/lib/constants";
import { useAuth } from "@/components/auth/AuthProvider";
import { LabelPicker } from "./LabelPicker";
import { summaryFor } from "./cup-label-summary";
import { flattenCups } from "@/lib/cup-label/use-gallery-auto-fill";

export function CupLabelSection() {
  const lines = useCart((s) => s.lines);
  const labelSelections = useCart((s) => s.labelSelections);
  const setLabel = useCart((s) => s.setLabel);
  const clearLabel = useCart((s) => s.clearLabel);
  const cartSessionId = useCart((s) => s.cartSessionId);
  const { profile } = useAuth();
  const isSignedIn = profile != null;

  const [pickerCupKey, setPickerCupKey] = useState<string | null>(null);

  if (lines.length === 0) return null;
  const cups = flattenCups(lines);
  if (cups.length === 0) return null;

  return (
    <>
      <section className="rounded-2xl border border-black/10 bg-white p-4 sm:p-5">
        <div className="mb-3 flex items-start justify-between gap-3 sm:mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold sm:text-lg">Cup labels</h2>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={{ backgroundColor: BRAND.accentColor, color: BRAND.primaryColor }}
              >
                Optional
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-500 sm:text-sm">
              Leave any cup as is and we&apos;ll print a surprise lucky cat 🐱.
              Want to choose your own? Tap a cup below.
            </p>
          </div>
        </div>

        <ul className="space-y-2">
          {cups.map((cup) => {
            const key = cupKey(cup.lineId, cup.cupIdx);
            const sel: CupLabelSelection | undefined = labelSelections[key];
            return (
              <li
                key={key}
                className="flex items-center gap-3 rounded-xl border border-black/5 p-2 sm:p-3"
              >
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-zinc-50 sm:h-16 sm:w-16">
                  {renderThumb(sel)}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{cup.itemName}</p>
                  <p className="truncate text-xs text-zinc-500">
                    {cup.variationName}
                    {cup.totalCups > 1
                      ? ` · Cup ${cup.cupIdx + 1} of ${cup.totalCups}`
                      : ""}
                  </p>
                  <p className="truncate text-xs text-zinc-400">{summaryFor(sel)}</p>
                </div>

                <button
                  type="button"
                  onClick={() => setPickerCupKey(key)}
                  className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-white sm:text-sm"
                  style={{ backgroundColor: BRAND.primaryColor }}
                >
                  {sel ? "Change" : "Choose"}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <LabelPicker
        open={pickerCupKey !== null}
        onOpenChange={(open) => {
          if (!open) setPickerCupKey(null);
        }}
        slotKey={pickerCupKey ?? ""}
        cartSessionId={cartSessionId}
        isSignedIn={isSignedIn}
        current={pickerCupKey ? labelSelections[pickerCupKey] : undefined}
        onSelect={(selection) => {
          if (pickerCupKey) setLabel(pickerCupKey, selection);
        }}
        onClear={() => {
          if (pickerCupKey) clearLabel(pickerCupKey);
        }}
      />
    </>
  );
}

function renderThumb(sel: CupLabelSelection | undefined) {
  if (!sel) {
    // Default (no pick) prints a random lucky cat — show a representative
    // cat so the thumb hints at what prints.
    return (
      <Image
        src="/cup-label/lucky-cat/a59c1cc2694cc43822317a53cce9463b/binarized.png"
        alt="Surprise lucky cat"
        fill
        sizes="64px"
        unoptimized
        className="object-contain"
      />
    );
  }
  if (sel.kind === "preset") {
    return (
      <Image
        src={`/cup-label/gallery/${sel.hash}/binarized.png`}
        alt=""
        fill
        sizes="64px"
        unoptimized
        className="object-contain"
      />
    );
  }
  if (sel.kind === "photo") {
    return (
      <Image
        src={sel.previewUrl}
        alt="Your uploaded photo"
        fill
        sizes="64px"
        unoptimized
        className="object-contain"
      />
    );
  }
  // kind === "ai" — no preview by design; placeholder star.
  return (
    <div className="flex h-full w-full items-center justify-center bg-zinc-50 text-xl">
      ✨
    </div>
  );
}
