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
import type { CupLabelSelection } from "@/store/cart";

type Manifest = { hashes: string[] };

type LabelPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** slotKey of the cup we're picking for — needed by AI submit (Task 6). */
  slotKey: string;
  /** Current cart-session id from useCart — scopes AI quota server-side. */
  cartSessionId: string;
  /** Whether the user is signed in — Photo/AI tabs gate on this. */
  isSignedIn: boolean;
  current: CupLabelSelection | undefined;
  onSelect: (selection: CupLabelSelection) => void;
};

type Tab = "preset" | "photo" | "ai";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "preset", label: "🎨 Gallery" },
  { key: "photo", label: "📷 Photo" },
  { key: "ai", label: "✨ AI" },
];

function initialTabFor(sel: CupLabelSelection | undefined): Tab {
  if (!sel) return "preset";
  if (sel.kind === "ai") return "ai";
  if (sel.kind === "photo") return "photo";
  return "preset";
}

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
  slotKey: _slotKey,
  cartSessionId: _cartSessionId,
  isSignedIn,
  current,
  onSelect,
}: LabelPickerProps) {
  const [tab, setTab] = useState<Tab>(() => initialTabFor(current));

  useEffect(() => {
    if (open) setTab(initialTabFor(current));
  }, [open, current]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Choose a label</DialogTitle>
          <DialogDescription>
            Pick a design and we&apos;ll print it onto your cup.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition"
              style={{
                backgroundColor: tab === t.key ? "white" : "transparent",
                color: tab === t.key ? BRAND.primaryColor : "#52525b",
                boxShadow: tab === t.key ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
              }}
              aria-pressed={tab === t.key}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-3">
          {tab === "preset" ? (
            <GalleryTab
              current={current?.kind === "preset" ? current.hash : undefined}
              onSelect={(hash) => {
                onSelect({ kind: "preset", hash });
                onOpenChange(false);
              }}
            />
          ) : tab === "photo" ? (
            <PhotoTabPlaceholder isSignedIn={isSignedIn} />
          ) : (
            <AiTabPlaceholder isSignedIn={isSignedIn} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GalleryTab({
  current,
  onSelect,
}: {
  current: string | undefined;
  onSelect: (hash: string) => void;
}) {
  const [manifest, setManifest] = useState<Manifest | null>(manifestCache);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (manifest) return;
    loadManifest().then(setManifest).catch((e) => setError(String(e)));
  }, [manifest]);

  if (error) return <p className="text-sm text-red-600">Failed to load gallery: {error}</p>;
  if (!manifest) return <p className="text-sm text-zinc-500">Loading…</p>;

  return (
    <div className="grid max-h-[60vh] grid-cols-3 gap-3 overflow-y-auto p-1 sm:grid-cols-4 md:grid-cols-5">
      {manifest.hashes.map((hash) => {
        const selected = hash === current;
        return (
          <button
            key={hash}
            type="button"
            onClick={() => onSelect(hash)}
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
  );
}

function PhotoTabPlaceholder({ isSignedIn }: { isSignedIn: boolean }) {
  if (!isSignedIn) return <SignInGate label="Photo" />;
  return <p className="text-sm text-zinc-500">Photo upload coming next.</p>;
}

function AiTabPlaceholder({ isSignedIn }: { isSignedIn: boolean }) {
  if (!isSignedIn) return <SignInGate label="AI" />;
  return <p className="text-sm text-zinc-500">AI generation coming next.</p>;
}

function SignInGate({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-600">
      <p>Sign in to use {label}.</p>
      <a
        href="/account"
        className="mt-2 inline-block rounded-md px-3 py-1.5 text-xs font-medium text-white"
        style={{ backgroundColor: BRAND.primaryColor }}
      >
        Sign in
      </a>
    </div>
  );
}
