"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { CupLabelSelection } from "@/store/cart";
import type { SvgPath } from "@/lib/doodle/render-svg";
import { CANVAS_W, CANVAS_H } from "./DrawCanvas";

// A to-scale mock of the 50×80mm sticker the Zebra prints (see
// lib/cup-label/render-zebra-cup.ts): black top band with the greeting and
// sticker number, a full-width square of artwork, and the drink name in
// the bottom band. Showing the customer the actual object — not a bare
// thumbnail — is what makes "choose a label" feel like designing a cup
// rather than picking an icon.
//
// Paper is always white, even in Evening Mode: the sticker is a physical
// thing, so its colours are pinned with arbitrary values rather than the
// theme tokens the rest of the checkout wears.

/** Representative cat for the no-pick default — the printer picks one at
 *  random, so this is a hint at what prints, not a promise. */
export const LUCKY_CAT_SAMPLE =
  "/cup-label/lucky-cat/a59c1cc2694cc43822317a53cce9463b/binarized.png";

/** Poll cadence + cap for AI previews. Doubao p95 is well under 30s; 90s
 *  covers retries. */
const AI_POLL_MS = 2_500;
const AI_POLL_MAX = 36;

/** The AI result's preview URL once the background job lands, else null.
 *  Shared by the picker's live preview and the checkout row thumbs. */
export function useAiPreview(aiDoodleId: string | null): string | null {
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

  return previewUrl;
}

export type StickerArt =
  | { kind: "image"; src: string; alt: string }
  | { kind: "paths"; paths: SvgPath[] }
  | { kind: "pending"; glyph: string; caption: string };

/** What to draw in the artwork square for a selection. `draft` is the
 *  picker's not-yet-committed candidate (a drawing in progress, a staged
 *  photo, a hovered gallery tile) and wins over the committed pick. */
export function artFor(
  selection: CupLabelSelection | undefined,
  aiPreviewUrl: string | null,
): StickerArt {
  if (!selection) {
    return { kind: "image", src: LUCKY_CAT_SAMPLE, alt: "Surprise lucky cat" };
  }
  if (selection.kind === "preset") {
    return {
      kind: "image",
      src: `/cup-label/gallery/${selection.hash}/binarized.png`,
      alt: "Gallery design",
    };
  }
  if (selection.kind === "photo") {
    return { kind: "image", src: selection.previewUrl, alt: "Your photo" };
  }
  if (selection.kind === "ai") {
    if (aiPreviewUrl) return { kind: "image", src: aiPreviewUrl, alt: "Your AI design" };
    return {
      kind: "pending",
      glyph: "✨",
      caption: selection.aiDoodleId ? "Drawing it now…" : "Sending…",
    };
  }
  return {
    kind: "pending",
    glyph: "✏️",
    caption: selection.userDoodleId ? "Your drawing" : "Saving…",
  };
}

export function StickerArtwork({ art }: { art: StickerArt }) {
  if (art.kind === "image") {
    return (
      <Image
        src={art.src}
        alt={art.alt}
        fill
        sizes="240px"
        unoptimized
        className="object-contain p-[4%]"
      />
    );
  }
  if (art.kind === "paths") {
    return (
      <svg
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        className="h-full w-full"
        aria-label="Your drawing"
      >
        {art.paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            stroke="#111"
            strokeWidth={p.width}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    );
  }
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-[#111]">
      <span className="text-3xl">{art.glyph}</span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] opacity-60">
        {art.caption}
      </span>
    </div>
  );
}

type Props = {
  art: StickerArt;
  /** "Hi, Stan" — the top-band greeting the printer uses. */
  greeting: string;
  /** "1/2" for multi-cup lines, otherwise empty. */
  cupFraction: string;
  itemName: string;
  variationName: string;
  className?: string;
};

export function StickerPreview({
  art,
  greeting,
  cupFraction,
  itemName,
  variationName,
  className = "",
}: Props) {
  return (
    <div
      className={`relative flex aspect-[590/945] w-full flex-col overflow-hidden rounded-[9%/5.6%] bg-[#fff] text-[#111] shadow-[0_18px_30px_-12px_rgba(42,30,20,0.45)] ring-1 ring-black/10 ${className}`}
      aria-label="Preview of the printed cup label"
    >
      {/* Top band — 90 of 945 dots. */}
      <div className="flex h-[9.5%] items-center justify-between bg-[#111] px-[6%] text-[#fff]">
        <span className="truncate text-[0.72em] font-bold leading-none">{greeting}</span>
        <span className="shrink-0 text-[0.72em] font-bold leading-none tabular-nums">
          OL··· {cupFraction}
        </span>
      </div>
      {/* Artwork — a full-width square. */}
      <div className="relative aspect-square w-full">
        <StickerArtwork art={art} />
      </div>
      {/* Bottom band — drink + variation, the prep info the front of the
          cup carries after the flip. */}
      <div className="flex min-h-0 flex-1 flex-col justify-center px-[7%] pb-[4%]">
        <span className="truncate text-[0.78em] font-bold leading-tight">{itemName}</span>
        <span className="truncate text-[0.62em] leading-tight opacity-70">{variationName}</span>
      </div>
    </div>
  );
}
