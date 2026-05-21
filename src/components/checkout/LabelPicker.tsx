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
import { useCart, type CupLabelSelection } from "@/store/cart";
import {
  uploadPhotoForCupLabel,
  submitAiCupLabel,
  readFileAsDataUri,
  AI_PROMPT_MAX_LEN,
  CupLabelClientError,
} from "@/lib/cup-label/client";

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
  slotKey,
  cartSessionId,
  isSignedIn,
  current,
  onSelect,
}: LabelPickerProps) {
  const [tab, setTab] = useState<Tab>(() => initialTabFor(current));

  // Photo tab state — hoisted from PhotoTab so the staged upload survives
  // tab switches while the Dialog is open. Reset whenever the Picker
  // reopens or the cup we're picking for changes.
  const [photoStaged, setPhotoStaged] = useState<
    Extract<CupLabelSelection, { kind: "photo" }> | null
  >(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTab(initialTabFor(current));
      setPhotoStaged(current?.kind === "photo" ? current : null);
      setPhotoError(null);
      setPhotoBusy(false);
    }
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
            <PhotoTab
              isSignedIn={isSignedIn}
              staged={photoStaged}
              setStaged={setPhotoStaged}
              busy={photoBusy}
              setBusy={setPhotoBusy}
              error={photoError}
              setError={setPhotoError}
              onSelect={(sel) => {
                onSelect(sel);
                onOpenChange(false);
              }}
            />
          ) : (
            <AiTab
              isSignedIn={isSignedIn}
              slotKey={slotKey}
              cartSessionId={cartSessionId}
              current={current?.kind === "ai" ? current : undefined}
              onSelect={(sel) => {
                onSelect(sel);
                onOpenChange(false);
              }}
            />
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

function PhotoTab({
  isSignedIn,
  staged,
  setStaged,
  busy,
  setBusy,
  error,
  setError,
  onSelect,
}: {
  isSignedIn: boolean;
  staged: Extract<CupLabelSelection, { kind: "photo" }> | null;
  setStaged: (sel: Extract<CupLabelSelection, { kind: "photo" }> | null) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  error: string | null;
  setError: (error: string | null) => void;
  onSelect: (sel: Extract<CupLabelSelection, { kind: "photo" }>) => void;
}) {
  if (!isSignedIn) return <SignInGate label="Photo" />;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const { uploadedDoodleId, previewUrl } = await uploadPhotoForCupLabel(file);
      setStaged({ kind: "photo", uploadedDoodleId, previewUrl });
    } catch (err) {
      const msg =
        err instanceof CupLabelClientError
          ? err.message
          : "Upload failed — please try again.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 p-2">
      {staged ? (
        <Image
          src={staged.previewUrl}
          alt="Your uploaded photo (binarised preview)"
          width={400}
          height={400}
          unoptimized
          className="h-64 w-64 rounded-md border border-zinc-200 object-contain"
        />
      ) : (
        <div className="flex h-64 w-64 items-center justify-center rounded-md border border-dashed border-zinc-300 text-sm text-zinc-500">
          No photo selected
        </div>
      )}

      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium">
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFile}
          disabled={busy}
          className="hidden"
        />
        {busy ? "Uploading…" : staged ? "Choose different photo" : "Choose a photo"}
      </label>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {staged ? (
        <button
          type="button"
          onClick={() => onSelect(staged)}
          className="rounded-md px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: BRAND.primaryColor }}
        >
          Use this photo
        </button>
      ) : null}
    </div>
  );
}

function AiTab({
  isSignedIn,
  slotKey,
  cartSessionId,
  current,
  onSelect,
}: {
  isSignedIn: boolean;
  slotKey: string;
  cartSessionId: string;
  current: Extract<CupLabelSelection, { kind: "ai" }> | undefined;
  onSelect: (sel: Extract<CupLabelSelection, { kind: "ai" }>) => void;
}) {
  const [prompt, setPrompt] = useState(current?.prompt ?? "");
  const [refDataUri, setRefDataUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isSignedIn) return <SignInGate label="AI" />;

  const trimmed = prompt.trim();
  const overLimit = prompt.length > AI_PROMPT_MAX_LEN;
  const canSubmit = trimmed.length > 0 && !overLimit;

  async function handleRefFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setError("Reference image too large (max 8 MB)");
      return;
    }
    setError(null);
    try {
      const dataUri = await readFileAsDataUri(file);
      setRefDataUri(dataUri);
    } catch {
      setError("Could not read reference image");
    }
  }

  function handleGenerate() {
    if (!canSubmit) return;
    // If the user re-hit Generate without changing prompt or attaching
    // a new reference image AND the previous submission already
    // resolved, just re-emit the same selection — no need to re-submit.
    if (
      current &&
      trimmed === current.prompt &&
      current.aiDoodleId !== null &&
      !refDataUri
    ) {
      onSelect(current);
      return;
    }
    setError(null);

    const promptSnapshot = trimmed;
    const refSnapshot = refDataUri;

    // Optimistic commit + close dialog immediately. Background submit
    // runs server-side via after() and stamps the real aiDoodleId onto
    // the cart entry once Doubao + binarize + Storage write completes.
    // If the user clicks Pay before then, that cup falls back to the
    // gallery default (buildPaymentSelections skips null aiDoodleId).
    onSelect({ kind: "ai", aiDoodleId: null, prompt: promptSnapshot });

    void submitAiCupLabel({
      slotKey,
      prompt: promptSnapshot,
      sourceImageBase64: refSnapshot ?? undefined,
      cartSessionId,
    })
      .then(({ aiDoodleId }) => {
        // Only stamp the real id if the user hasn't already overwritten
        // this slot with a new selection (e.g. picked Photo instead).
        const cur = useCart.getState().labelSelections[slotKey];
        if (
          cur?.kind === "ai" &&
          cur.prompt === promptSnapshot &&
          cur.aiDoodleId === null
        ) {
          useCart.getState().setLabel(slotKey, {
            kind: "ai",
            aiDoodleId,
            prompt: promptSnapshot,
          });
        }
      })
      .catch((err) => {
        console.error("[cup-label] AI submit failed (background)", err);
        // Clear the pending marker so auto-random refills with a gallery
        // preset — better than leaving the cup row stuck at "working…".
        const cur = useCart.getState().labelSelections[slotKey];
        if (cur?.kind === "ai" && cur.aiDoodleId === null) {
          useCart.getState().clearLabel(slotKey);
        }
      });
  }

  return (
    <div className="flex flex-col gap-3 p-2">
      <label className="text-sm font-medium">
        Describe your design
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={AI_PROMPT_MAX_LEN + 50}
          rows={3}
          placeholder="e.g. two cats reading on a moon, line drawing"
          className="mt-1 w-full rounded-md border border-zinc-300 p-2 text-sm"
        />
      </label>
      <p
        className="text-xs"
        style={{ color: overLimit ? "#dc2626" : "#71717a" }}
      >
        {prompt.length}/{AI_PROMPT_MAX_LEN}
      </p>

      <div className="flex items-center gap-3 self-start">
        {refDataUri ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={refDataUri}
            alt="Reference image preview"
            className="h-16 w-16 rounded-md border border-zinc-200 object-cover"
          />
        ) : null}
        <div className="flex flex-col gap-1">
          <label className="flex cursor-pointer items-center gap-2 self-start rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50">
            <input
              type="file"
              accept="image/*"
              onChange={handleRefFile}
              className="hidden"
            />
            📎 {refDataUri ? "Change reference image" : "Add a reference image (optional)"}
          </label>
          {refDataUri ? (
            <button
              type="button"
              onClick={() => setRefDataUri(null)}
              className="self-start text-xs text-zinc-500 underline hover:text-red-600"
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="button"
        onClick={handleGenerate}
        disabled={!canSubmit}
        className="self-end rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: BRAND.primaryColor }}
      >
        Generate
      </button>
    </div>
  );
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
