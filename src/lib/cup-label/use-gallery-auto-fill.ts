"use client";

import { useEffect, useRef, useState } from "react";
import { useCart, cupKey, type CartLine } from "@/store/cart";

export type GalleryManifest = { hashes: string[] };

let manifestCache: GalleryManifest | null = null;
let manifestInFlight: Promise<GalleryManifest> | null = null;

// Module-level "we've already considered this cupKey for auto-fill" set,
// shared between cart drawer + /checkout so two mounts don't race to write
// different random presets to the same cup.
const seenCupKeys = new Set<string>();

async function loadGalleryManifest(): Promise<GalleryManifest> {
  if (manifestCache) return manifestCache;
  if (manifestInFlight) return manifestInFlight;
  manifestInFlight = (async () => {
    const res = await fetch("/cup-label/gallery/manifest.json");
    if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`);
    const data = (await res.json()) as GalleryManifest;
    manifestCache = data;
    return data;
  })();
  try {
    return await manifestInFlight;
  } finally {
    manifestInFlight = null;
  }
}

function pickRandomHash(hashes: string[]): string {
  return hashes[Math.floor(Math.random() * hashes.length)] ?? "";
}

/**
 * Auto-fill each (lineId, cupIdx) cup with a random preset hash the first
 * time we see it, unless the user already picked something. Pruning on
 * quantity change / line removal happens in the cart store itself.
 *
 * `active` lets a consumer (e.g. the cart drawer) defer fetching until the
 * surface is opened at least once.
 */
export function useGalleryAutoFill({ active }: { active: boolean }) {
  const lines = useCart((s) => s.lines);
  const labelSelections = useCart((s) => s.labelSelections);
  const setLabel = useCart((s) => s.setLabel);
  const [manifest, setManifest] = useState<GalleryManifest | null>(manifestCache);

  useEffect(() => {
    if (!active || manifest) return;
    let cancelled = false;
    loadGalleryManifest()
      .then((m) => {
        if (!cancelled) setManifest(m);
      })
      .catch(() => {
        // Network blip — fallback path on server-side enqueue.ts still picks
        // a default; UI just shows the placeholder thumbnail.
      });
    return () => {
      cancelled = true;
    };
  }, [active, manifest]);

  useEffect(() => {
    if (!manifest || manifest.hashes.length === 0) return;
    for (const line of lines) {
      for (let i = 0; i < line.quantity; i++) {
        const key = cupKey(line.id, i);
        if (seenCupKeys.has(key)) continue;
        seenCupKeys.add(key);
        if (!labelSelections[key]) {
          setLabel(key, { kind: "preset", hash: pickRandomHash(manifest.hashes) });
        }
      }
    }
  }, [lines, manifest, labelSelections, setLabel]);

  return manifest;
}

export function flattenCups(
  lines: CartLine[],
): Array<{
  lineId: string;
  cupIdx: number;
  itemName: string;
  variationName: string;
  totalCups: number;
}> {
  const out = [];
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
