"use client";

import { useEffect, useState } from "react";
import { useCart, cupKey, type CupLabelSelection } from "@/store/cart";
import { useAuth } from "@/components/auth/AuthProvider";
import { LabelPicker } from "./LabelPicker";
import { summaryFor } from "./cup-label-summary";
import { flattenCups } from "@/lib/cup-label/use-gallery-auto-fill";
import {
  PHOTO_LABELS_OFFLINE,
  PHOTO_LABELS_OFFLINE_NOTICE,
} from "@/lib/cup-label/label-mode";
import { StickerArtwork, artFor, useAiPreview } from "./cup-label/StickerPreview";

// Wears the checkout page's one card style (see CARD / SectionLabel in
// app/checkout/page.tsx) so the section sits in the same rhythm as
// Fulfillment, Rewards and Your details rather than importing its own
// border, radius and greys.
const CARD =
  "rounded-card border border-line bg-card p-5 shadow-[var(--shadow-card-v)] sm:p-6";
const EYEBROW = "text-[11.5px] font-bold uppercase tracking-[0.14em] text-ink3";

/**
 * Shown in place of the picker while the 40×30 text-only paper is loaded
 * (see lib/cup-label/label-mode.ts). Also drains any label selections
 * still sitting in the persisted cart — a stale in-flight AI/draw
 * selection would otherwise wedge the checkout gate forever with no UI
 * left to clear it.
 */
function CupLabelOfflineNotice() {
  const lines = useCart((s) => s.lines);
  const labelSelections = useCart((s) => s.labelSelections);
  const clearLabel = useCart((s) => s.clearLabel);

  useEffect(() => {
    for (const key of Object.keys(labelSelections)) clearLabel(key);
  }, [labelSelections, clearLabel]);

  if (lines.length === 0) return null;
  return (
    <section className={CARD}>
      <div className="flex items-center gap-2">
        <h3 className={EYEBROW}>Cup labels</h3>
        <span className="rounded-full bg-cream px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand">
          Back soon
        </span>
      </div>
      <p className="mt-1 text-[13px] leading-snug text-ink3">{PHOTO_LABELS_OFFLINE_NOTICE}</p>
    </section>
  );
}

export function CupLabelSection() {
  if (PHOTO_LABELS_OFFLINE) return <CupLabelOfflineNotice />;
  return <CupLabelPickerSection />;
}

function CupLabelPickerSection() {
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

  const pickerCup = pickerCupKey
    ? (cups.find((c) => cupKey(c.lineId, c.cupIdx) === pickerCupKey) ?? null)
    : null;

  return (
    <>
      <section className={CARD}>
        <div className="flex items-center gap-2">
          <h3 className={EYEBROW}>Cup labels</h3>
          <span className="rounded-full bg-cream px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand">
            Optional
          </span>
        </div>
        <p className="mt-1 text-[13px] leading-snug text-ink3">
          Every cup gets a printed sticker. Leave it and we&apos;ll surprise you
          with a lucky cat 🐱 — or tap a cup to put your own design on it.
        </p>

        <ul className="mt-4 space-y-2">
          {cups.map((cup) => {
            const key = cupKey(cup.lineId, cup.cupIdx);
            const sel: CupLabelSelection | undefined = labelSelections[key];
            const chosen = sel !== undefined;
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => setPickerCupKey(key)}
                  className={`flex w-full items-center gap-3.5 rounded-tile border p-2.5 text-left transition hover:border-ink4 ${
                    chosen ? "border-brand/40 bg-cream/60" : "border-line bg-card"
                  }`}
                  aria-label={`${chosen ? "Change" : "Choose"} the label for ${cup.itemName}${
                    cup.totalCups > 1 ? `, cup ${cup.cupIdx + 1} of ${cup.totalCups}` : ""
                  }`}
                >
                  {/* The artwork square of the sticker, at thumb size. */}
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[8px] bg-[#fff] ring-1 ring-black/10 sm:h-16 sm:w-16">
                    <CupThumb sel={sel} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-ink">{cup.itemName}</p>
                    <p className="truncate text-[12px] text-ink3">
                      {cup.variationName}
                      {cup.totalCups > 1
                        ? ` · Cup ${cup.cupIdx + 1} of ${cup.totalCups}`
                        : ""}
                    </p>
                    <p
                      className={`mt-0.5 truncate text-[12px] ${
                        chosen ? "font-semibold text-brand" : "text-ink3"
                      }`}
                    >
                      {summaryFor(sel)}
                    </p>
                  </div>

                  <span
                    className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold ${
                      chosen
                        ? "border border-line bg-card text-ink2"
                        : "bg-ink text-cream"
                    }`}
                  >
                    {chosen ? "Change" : "Choose"}
                  </span>
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
        cup={pickerCup}
        greetingName={profile?.first_name ?? null}
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

/** Row thumbnail — the same artwork the sticker preview shows, including
 *  the AI result once the background job lands. */
function CupThumb({ sel }: { sel: CupLabelSelection | undefined }) {
  const aiPreviewUrl = useAiPreview(sel?.kind === "ai" ? sel.aiDoodleId : null);
  const art = artFor(sel, aiPreviewUrl);
  if (art.kind === "pending") {
    return (
      <div className="flex h-full w-full items-center justify-center text-xl">
        {/* Generating: pulse so "working" and "this is your final icon"
            don't look identical. */}
        <span className={sel?.kind === "ai" && sel.aiDoodleId ? "animate-pulse" : ""}>
          {art.glyph}
        </span>
      </div>
    );
  }
  return <StickerArtwork art={art} />;
}
