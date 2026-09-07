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
import {
  StickerArtwork,
  artFor,
  useAiPreview,
  useGalleryThumb,
} from "./cup-label/StickerPreview";

// Wears the checkout page's one card style (see CARD / SectionLabel in
// app/checkout/page.tsx) so the section sits in the same rhythm as
// Fulfillment, Rewards and Your details rather than importing its own
// border, radius and greys.
const CARD =
  "rounded-card border border-line bg-card p-5 shadow-[var(--shadow-card-v)] sm:p-6";
const EYEBROW = "text-[11.5px] font-bold uppercase tracking-[0.14em] text-ink3";

/** Thumbnails drawn before the row falls back to "+N". Four 44px tiles plus
 *  the label text and the pill is what fits at 360px without the name
 *  truncating to nothing. */
const MAX_THUMBS = 4;

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

  const chosenCount = cups.filter(
    (c) => labelSelections[cupKey(c.lineId, c.cupIdx)] !== undefined,
  ).length;
  // The pill opens the first cup still wearing the default — that's the one
  // the customer means by "Choose". Once every cup is done it says "Change"
  // and reopens the first, which is where a second pass starts anyway.
  const nextCup =
    cups.find((c) => labelSelections[cupKey(c.lineId, c.cupIdx)] === undefined) ??
    cups[0];

  return (
    <>
      {/* One row of thumbnails, whatever the cup count. This used to be a
          stacked list — a 76px row per cup — so at 375px the card measured
          215px for one cup, 303 for two and 569 for five, on a step that is
          optional and has a good default. It is now 165px flat (#371).

          Folded, but not hidden: the artwork is still on the page, every
          thumbnail still opens that cup's picker, and the pill still names
          the action. What went is the vertical repetition, not the door. */}
      <section className={CARD}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className={EYEBROW}>Cup labels</h3>
            <span className="shrink-0 rounded-full bg-cream px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand">
              Optional
            </span>
          </div>
          <button
            type="button"
            onClick={() => setPickerCupKey(cupKey(nextCup.lineId, nextCup.cupIdx))}
            className={`-mt-1 shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition ${
              chosenCount === cups.length
                ? "border border-line bg-card text-ink2 hover:bg-bg2"
                : "bg-ink text-cream hover:opacity-90"
            }`}
          >
            {chosenCount === cups.length ? "Change" : "Choose"}
          </button>
        </div>

        <p className="mt-1 text-[13px] leading-snug text-ink3">
          {chosenCount === 0
            ? "Lucky cat 🐱 on every cup — tap one to change it."
            : chosenCount === cups.length
              ? `Your design on ${cups.length === 1 ? "your cup" : "every cup"} — tap to change.`
              : `${chosenCount} of ${cups.length} customised — tap a cup to change it.`}
        </p>

        <ul className="mt-3 flex flex-wrap items-center gap-1.5">
          {cups.slice(0, MAX_THUMBS).map((cup) => {
            const key = cupKey(cup.lineId, cup.cupIdx);
            const sel: CupLabelSelection | undefined = labelSelections[key];
            const chosen = sel !== undefined;
            return (
              <li key={key}>
                {/* aria-label carries the per-cup summary the stacked rows
                    used to print under each name. Sighted users read it off
                    the artwork now; this is where it stays legible to
                    everyone else. */}
                <button
                  type="button"
                  onClick={() => setPickerCupKey(key)}
                  className={`relative block h-11 w-11 overflow-hidden rounded-[8px] bg-[#fff] transition ${
                    chosen
                      ? "ring-2 ring-brand"
                      : "ring-1 ring-black/10 hover:ring-ink4"
                  }`}
                  aria-label={`${cup.itemName}${
                    cup.totalCups > 1 ? `, cup ${cup.cupIdx + 1} of ${cup.totalCups}` : ""
                  } — ${summaryFor(sel)}. Tap to ${chosen ? "change" : "choose"} its label.`}
                >
                  <CupThumb sel={sel} />
                </button>
              </li>
            );
          })}
          {cups.length > MAX_THUMBS && (
            <li className="flex h-11 items-center pl-1 text-[12px] font-semibold text-ink3">
              +{cups.length - MAX_THUMBS}
            </li>
          )}
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
  const presetThumbUrl = useGalleryThumb(sel?.kind === "preset" ? sel.hash : null);
  const art = artFor(sel, aiPreviewUrl, presetThumbUrl);
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
