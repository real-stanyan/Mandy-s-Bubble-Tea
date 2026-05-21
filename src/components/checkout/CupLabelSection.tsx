"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useCart, cupKey, type CartLine, type CupLabelSelection } from "@/store/cart";
import { BRAND } from "@/lib/constants";
import { useAuth } from "@/components/auth/AuthProvider";
import { LabelPicker } from "./LabelPicker";
import { summaryFor } from "./cup-label-summary";

type GalleryManifest = { hashes: string[] };

let manifestCache: GalleryManifest | null = null;

async function loadGalleryManifest(): Promise<GalleryManifest> {
  if (manifestCache) return manifestCache;
  const res = await fetch("/cup-label/gallery/manifest.json");
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`);
  const data = (await res.json()) as GalleryManifest;
  manifestCache = data;
  return data;
}

function pickRandomHash(hashes: string[]): string {
  return hashes[Math.floor(Math.random() * hashes.length)];
}

type Cup = {
  lineId: string;
  cupIdx: number;
  itemName: string;
  variationName: string;
  totalCups: number;
};

function flattenCups(lines: CartLine[]): Cup[] {
  const out: Cup[] = [];
  for (const line of lines) {
    for (let i = 0; i < line.quantity; i++) {
      out.push({
        lineId: line.id,
        cupIdx: i,
        itemName: line.itemName,
        variationName: line.variationName,
        totalCups: line.quantity,
      });
    }
  }
  return out;
}

export function CupLabelSection() {
  const lines = useCart((s) => s.lines);
  const labelSelections = useCart((s) => s.labelSelections);
  const setLabel = useCart((s) => s.setLabel);
  const cartSessionId = useCart((s) => s.cartSessionId);
  const { profile } = useAuth();
  const isSignedIn = profile != null;

  const [pickerCupKey, setPickerCupKey] = useState<string | null>(null);
  const [manifest, setManifest] = useState<GalleryManifest | null>(manifestCache);

  // Track which cupKeys we've already considered for auto-random fill so
  // that user-explicit clears (✕) don't get re-filled on the next render.
  // Ref intentionally per-mount; on reload, persisted labelSelections still
  // protect populated cups via the `!selections[key]` check below.
  const seenCupKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!manifest) {
      loadGalleryManifest().then(setManifest).catch(() => {});
    }
  }, [manifest]);

  useEffect(() => {
    if (!manifest || manifest.hashes.length === 0) return;
    for (const line of lines) {
      for (let i = 0; i < line.quantity; i++) {
        const key = cupKey(line.id, i);
        if (seenCupKeys.current.has(key)) continue;
        seenCupKeys.current.add(key);
        // Only fill when no user selection yet (also covers persisted picks
        // hydrated from localStorage on reload).
        if (!labelSelections[key]) {
          setLabel(key, { kind: "preset", hash: pickRandomHash(manifest.hashes) });
        }
      }
    }
  }, [lines, manifest, labelSelections, setLabel]);

  if (lines.length === 0) return null;
  const cups = flattenCups(lines);
  if (cups.length === 0) return null;

  return (
    <>
      <section className="rounded-2xl border border-black/10 bg-white p-4 sm:p-5">
        <div className="mb-3 flex items-start justify-between gap-3 sm:mb-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold sm:text-lg">Cup Labels</h2>
            <p className="mt-1 text-xs text-zinc-500 sm:text-sm">
              We pick a design for each cup automatically. Tap Change to
              swap any of them.
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
                  Change
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
      />
    </>
  );
}

function renderThumb(sel: CupLabelSelection | undefined) {
  if (!sel) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">
        —
      </div>
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
