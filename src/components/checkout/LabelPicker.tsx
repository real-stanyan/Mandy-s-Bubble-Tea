"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { BRAND } from "@/lib/constants";

type Manifest = { hashes: string[] };

type LabelPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently-selected hash for the cup we're picking for. */
  current?: string;
  onSelect: (hash: string) => void;
};

let manifestCache: Manifest | null = null;

async function loadManifest(): Promise<Manifest> {
  if (manifestCache) return manifestCache;
  const res = await fetch("/cup-label/gallery/manifest.json");
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`);
  const data = (await res.json()) as Manifest;
  manifestCache = data;
  return data;
}

export function LabelPicker({
  open,
  onOpenChange,
  current,
  onSelect,
}: LabelPickerProps) {
  const [manifest, setManifest] = useState<Manifest | null>(manifestCache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || manifest) return;
    loadManifest().then(setManifest).catch((e) => setError(String(e)));
  }, [open, manifest]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Choose a label</DialogTitle>
          <DialogDescription>
            Pick a design and we&apos;ll print it onto your cup.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-red-600">Failed to load gallery: {error}</p>
        ) : !manifest ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : (
          <div className="grid max-h-[60vh] grid-cols-3 gap-3 overflow-y-auto p-1 sm:grid-cols-4 md:grid-cols-5">
            {manifest.hashes.map((hash) => {
              const selected = hash === current;
              return (
                <button
                  key={hash}
                  type="button"
                  onClick={() => {
                    onSelect(hash);
                    onOpenChange(false);
                  }}
                  className="relative h-28 w-full overflow-hidden rounded-md border bg-white transition hover:shadow-md focus:outline-none focus:ring-2 sm:h-32 md:h-36"
                  style={{
                    borderColor: selected ? BRAND.primaryColor : "#e4e4e7",
                    borderWidth: selected ? 3 : 1,
                  }}
                  aria-label={`Select label ${hash.slice(0, 8)}`}
                  aria-pressed={selected}
                >
                  <Image
                    src={`/cup-label/gallery/${hash}/binarized.png`}
                    alt=""
                    width={592}
                    height={592}
                    unoptimized
                    className="h-full w-full object-contain p-1"
                  />
                  {selected ? (
                    <span
                      className="absolute right-1 top-1 rounded-full px-1.5 py-0.5 text-xs font-medium text-white"
                      style={{ backgroundColor: BRAND.primaryColor }}
                    >
                      ✓
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
