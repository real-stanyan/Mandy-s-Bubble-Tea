"use client";

import { useEffect, useState } from "react";
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
  // kind === "ai" — poll until the background job lands, then show the
  // result. Memory Stamp made the old always-✨ placeholder untenable: the
  // whole point of the feature is what the stamp looks like.
  if (sel.kind === "ai") return <AiThumb aiDoodleId={sel.aiDoodleId} />;
  // Residual case: a draw selection with nothing on the canvas yet.
  return (
    <div className="flex h-full w-full items-center justify-center bg-zinc-50 text-xl">
      ✨
    </div>
  );
}

/** Poll cadence + cap. Doubao p95 is well under 30s; 90s covers retries. */
const AI_POLL_MS = 2_500;
const AI_POLL_MAX = 36;

function AiThumb({ aiDoodleId }: { aiDoodleId: string | null }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    // No id yet (submit still in flight) — the cart re-renders us with the
    // real id the moment the submit callback stamps it.
    if (!aiDoodleId) return;
    setPreviewUrl(null);
    let cancelled = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      tries += 1;
      try {
        const res = await fetch(
          `/api/cup-label/ai-status?aiDoodleId=${encodeURIComponent(aiDoodleId)}`,
        );
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          status?: string;
          previewUrl?: string;
        };
        if (cancelled) return;
        if (json.ok && json.status === "ready" && json.previewUrl) {
          setPreviewUrl(json.previewUrl);
          return;
        }
        // failed → stop polling and keep the placeholder; the submit path
        // separately clears the slot back to a gallery default.
        if (json.ok && json.status === "failed") return;
      } catch {
        /* transient — next tick retries */
      }
      if (!cancelled && tries < AI_POLL_MAX) {
        timer = setTimeout(tick, AI_POLL_MS);
      }
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [aiDoodleId]);

  if (previewUrl) {
    return (
      <Image
        src={previewUrl}
        alt="Your AI cup label"
        fill
        sizes="64px"
        unoptimized
        className="object-contain"
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-zinc-50 text-xl">
      {aiDoodleId ? (
        // Generating: pulse so "working" and "this is your final icon" don't
        // look identical.
        <span className="animate-pulse">✨</span>
      ) : (
        "✨"
      )}
    </div>
  );
}
