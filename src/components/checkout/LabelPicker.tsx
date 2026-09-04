"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useCart, type CupLabelSelection } from "@/store/cart";
import {
  uploadPhotoForCupLabel,
  uploadDrawingForCupLabel,
  submitAiCupLabel,
  readFileAsDataUri,
  downscaleDataUriForAi,
  AI_PROMPT_MAX_LEN,
  CupLabelClientError,
} from "@/lib/cup-label/client";
import { DrawCanvas, BRUSHES, type BrushWidth } from "./cup-label/DrawCanvas";
import {
  StickerPreview,
  artFor,
  useAiPreview,
  type StickerArt,
} from "./cup-label/StickerPreview";
import {
  MEMORY_STAMP_STYLE_ID,
  MEMORY_STAMP_LABEL,
} from "@/lib/cup-label/stamp-style";
import type { SvgPath } from "@/lib/doodle/render-svg";

/** Cart-line label AND the client-side dedupe key for stamp submissions. */
const MEMORY_STAMP_SENTINEL = MEMORY_STAMP_LABEL;

// The label picker is a small design studio for one cup: the printed
// sticker on the left, live, and the four ways to fill it on the right.
// Every source (gallery, drawing, AI, photo) feeds the same preview, so
// "what will my cup look like" is answered before anything is committed.
// Visual language is the checkout's own — token colours, the card radius,
// the eyebrow/hint hierarchy — so the dialog reads as part of the page it
// opened from, not a stock component dropped on top of it.

type GalleryItem = { hash: string; thumbUrl: string; source: "builtin" | "upload" };
type Gallery = { presets: GalleryItem[] };

export type LabelPickerCup = {
  itemName: string;
  variationName: string;
  cupIdx: number;
  totalCups: number;
};

type LabelPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** slotKey of the cup we're picking for — needed by AI submit (Task 6). */
  slotKey: string;
  /** Current cart-session id from useCart — scopes AI quota server-side. */
  cartSessionId: string;
  /** Whether the user is signed in — Photo/AI tabs gate on this. */
  isSignedIn: boolean;
  /** The cup being labelled — drives the sticker preview's text. */
  cup: LabelPickerCup | null;
  /** First name for the sticker's "Hi, Stan" band; null → "Hi there". */
  greetingName: string | null;
  current: CupLabelSelection | undefined;
  onSelect: (selection: CupLabelSelection) => void;
  /** Clear this cup's pick so it falls back to a random surprise lucky cat. */
  onClear: () => void;
};

type Tab = "preset" | "draw" | "ai" | "photo";

const TABS: Array<{ key: Tab; label: string; glyph: string }> = [
  { key: "preset", label: "Gallery", glyph: "🎨" },
  { key: "draw", label: "Draw", glyph: "✏️" },
  { key: "ai", label: "AI", glyph: "✨" },
  { key: "photo", label: "Photo", glyph: "📷" },
];

function initialTabFor(sel: CupLabelSelection | undefined): Tab {
  if (!sel) return "preset";
  if (sel.kind === "ai") return "ai";
  if (sel.kind === "photo") return "photo";
  if (sel.kind === "draw") return "draw";
  return "preset";
}

let galleryCache: Gallery | null = null;
async function loadGallery(): Promise<Gallery> {
  if (galleryCache) return galleryCache;
  const res = await fetch("/api/cup-label/gallery");
  if (!res.ok) throw new Error(`gallery fetch failed: ${res.status}`);
  const data = (await res.json()) as Gallery;
  galleryCache = data;
  return data;
}

// One button vocabulary for the whole dialog. Primary is the page's dark
// pill (bg-ink stays dark in Evening Mode, so cream text always reads);
// ghost is the quiet bordered pill for undo / change / sign in.
const BTN_PRIMARY =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-ink px-5 text-[13px] font-semibold text-cream transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:opacity-35";
const BTN_GHOST =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-line bg-card px-4 text-[12.5px] font-semibold text-ink2 transition hover:border-ink4 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line";
const EYEBROW = "text-[11px] font-bold uppercase tracking-[0.14em] text-ink3";
const FIELD =
  "w-full rounded-tile border border-line bg-card px-3 py-2.5 text-[13.5px] text-ink placeholder:text-ink4 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function LabelPicker({
  open,
  onOpenChange,
  slotKey,
  cartSessionId,
  isSignedIn,
  cup,
  greetingName,
  current,
  onSelect,
  onClear,
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

  // Not-yet-committed candidates, so the sticker preview answers "what
  // would this look like" before the customer commits: the drawing as it
  // is drawn, the gallery tile under the pointer.
  const [draftPaths, setDraftPaths] = useState<SvgPath[]>([]);
  const [hoverHash, setHoverHash] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTab(initialTabFor(current));
      setPhotoStaged(current?.kind === "photo" ? current : null);
      setPhotoError(null);
      setPhotoBusy(false);
      setDraftPaths([]);
      setHoverHash(null);
    }
  }, [open, current]);

  const aiPreviewUrl = useAiPreview(current?.kind === "ai" ? current.aiDoodleId : null);

  let art: StickerArt = artFor(current, aiPreviewUrl);
  if (tab === "preset" && hoverHash) {
    art = {
      kind: "image",
      src: `/cup-label/gallery/${hoverHash}/binarized.png`,
      alt: "Gallery design",
    };
  } else if (tab === "draw" && draftPaths.length > 0) {
    art = { kind: "paths", paths: draftPaths };
  } else if (tab === "photo" && photoStaged) {
    art = { kind: "image", src: photoStaged.previewUrl, alt: "Your photo" };
  }

  const greeting = greetingName ? `Hi, ${greetingName}` : "Hi there";
  const cupFraction = cup && cup.totalCups > 1 ? `${cup.cupIdx + 1}/${cup.totalCups}` : "";
  const cupChip = cup
    ? `${cup.itemName}${cup.totalCups > 1 ? ` · Cup ${cup.cupIdx + 1} of ${cup.totalCups}` : ""}`
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // The primitive's `max-w-md` sorts after a bare `max-w-3xl` in the
        // stylesheet, so the wide layout needs the variant to win.
        className="gap-0 overflow-hidden p-0 sm:w-[calc(100%-2rem)] sm:max-w-[900px] max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:left-0 max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none"
        aria-describedby={undefined}
      >
        <div className="flex max-h-[92dvh] flex-col sm:max-h-[86vh]">
          {/* Header */}
          <div className="border-b border-line px-5 pb-4 pt-5 sm:px-6">
            <p className={EYEBROW}>Cup label · optional</p>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 pr-8">
              <DialogTitle className="font-serif text-[22px] leading-none text-ink">
                Make this cup yours
              </DialogTitle>
              {cupChip ? (
                <span className="rounded-full bg-cream px-2.5 py-1 text-[11.5px] font-semibold text-brand">
                  {cupChip}
                </span>
              ) : null}
            </div>
            <DialogDescription className="mt-1.5 text-[13px] leading-snug text-ink3">
              Leave it for a surprise lucky cat 🐱, or put your own design on
              the sticker — it prints exactly like the preview.
            </DialogDescription>
          </div>

          {/* Body */}
          <div className="grid min-h-0 flex-1 overflow-y-auto sm:grid-cols-[232px_1fr]">
            {/* The sticker, live. */}
            <aside className="flex items-center gap-4 border-b border-line bg-bg/60 p-4 sm:flex-col sm:items-stretch sm:border-b-0 sm:border-r sm:p-5">
              <div className="w-[104px] shrink-0 sm:mx-auto sm:w-[172px] sm:rotate-[-1.5deg]">
                <StickerPreview
                  art={art}
                  greeting={greeting}
                  cupFraction={cupFraction}
                  itemName={cup?.itemName ?? "Your drink"}
                  variationName={cup?.variationName ?? ""}
                  className="text-[13px] sm:text-[16px]"
                />
              </div>
              <div className="min-w-0 flex-1 sm:flex-none">
                <p className="hidden text-center text-[11px] text-ink3 sm:block">
                  Your sticker, to scale
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClear();
                    onOpenChange(false);
                  }}
                  aria-pressed={current === undefined}
                  className={`flex w-full items-center gap-2.5 rounded-tile border px-3 py-2.5 text-left transition sm:mt-3 ${
                    current === undefined
                      ? "border-brand bg-cream"
                      : "border-line bg-card hover:border-ink4"
                  }`}
                >
                  <span className="text-lg leading-none">🐱</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-ink">
                      Surprise me
                    </span>
                    <span className="block text-[11px] text-ink3">
                      A random lucky cat
                    </span>
                  </span>
                  {current === undefined ? (
                    <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-white">
                      ✓
                    </span>
                  ) : null}
                </button>
              </div>
            </aside>

            {/* The ways to fill it. */}
            <div className="min-w-0 p-4 sm:p-5">
              <div
                role="tablist"
                aria-label="Label source"
                className="grid grid-cols-4 gap-1 rounded-full bg-bg2/70 p-1"
              >
                {TABS.map((t) => {
                  const active = tab === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setTab(t.key)}
                      className={`flex h-9 items-center justify-center gap-1.5 rounded-full text-[12.5px] font-semibold transition ${
                        active
                          ? "bg-card text-brand shadow-[var(--shadow-card-v)]"
                          : "text-ink3 hover:text-ink2"
                      }`}
                    >
                      <span aria-hidden="true">{t.glyph}</span>
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4">
                {tab === "preset" ? (
                  <GalleryTab
                    current={current?.kind === "preset" ? current.hash : undefined}
                    onHover={setHoverHash}
                    onSelect={(hash) => {
                      onSelect({ kind: "preset", hash });
                      onOpenChange(false);
                    }}
                  />
                ) : tab === "draw" ? (
                  <DrawTab
                    isSignedIn={isSignedIn}
                    slotKey={slotKey}
                    onPathsChange={setDraftPaths}
                    onSelect={(sel) => {
                      onSelect(sel);
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
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-tile bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
      {children}
    </p>
  );
}

function GalleryTab({
  current,
  onHover,
  onSelect,
}: {
  current: string | undefined;
  onHover: (hash: string | null) => void;
  onSelect: (hash: string) => void;
}) {
  const [gallery, setGallery] = useState<Gallery | null>(galleryCache);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (gallery) return;
    loadGallery().then(setGallery).catch((e) => setError(String(e)));
  }, [gallery]);

  if (error) return <ErrorLine>Failed to load gallery: {error}</ErrorLine>;
  if (!gallery) {
    return (
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4" aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-square animate-pulse rounded-tile bg-bg2/60" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <p className="mb-2.5 text-[12.5px] text-ink3">
        Hand-drawn by us. Hover to try one on, tap to keep it.
      </p>
      <div
        className="grid grid-cols-3 gap-2.5 sm:max-h-[52vh] sm:grid-cols-4 sm:overflow-y-auto sm:pr-1"
        onMouseLeave={() => onHover(null)}
      >
        {gallery.presets.map(({ hash, thumbUrl }) => {
          const selected = hash === current;
          return (
            <button
              key={hash}
              type="button"
              onClick={() => onSelect(hash)}
              onMouseEnter={() => onHover(hash)}
              onFocus={() => onHover(hash)}
              onBlur={() => onHover(null)}
              className={`relative aspect-square w-full overflow-hidden rounded-tile border bg-[#fff] p-1.5 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-v)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                selected ? "border-brand ring-2 ring-brand/30" : "border-line"
              }`}
              aria-label={`Select label ${hash.slice(0, 8)}`}
              aria-pressed={selected}
            >
              <Image
                src={thumbUrl}
                alt=""
                width={592}
                height={592}
                unoptimized
                className="h-full w-full object-contain"
              />
              {selected ? (
                <span className="absolute right-1.5 top-1.5 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-white">
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
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
  if (!isSignedIn) return <SignInGate label="photo labels" />;

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
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-ink3">
        Pets, friends, a holiday snap. We turn it into crisp black-and-white
        ink for the sticker — simple, high-contrast photos print best.
      </p>

      <label
        className={`relative mx-auto flex aspect-square w-full max-w-[240px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-tile border-2 border-dashed transition ${
          staged
            ? "border-line bg-[#fff]"
            : "border-line bg-bg/60 hover:border-brand hover:bg-cream"
        } ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        <input
          type="file"
          accept="image/*"
          onChange={handleFile}
          disabled={busy}
          className="sr-only"
        />
        {staged ? (
          <Image
            src={staged.previewUrl}
            alt="Your uploaded photo (binarised preview)"
            fill
            sizes="240px"
            unoptimized
            className="object-contain p-2"
          />
        ) : (
          <>
            <span className="text-3xl" aria-hidden="true">
              📷
            </span>
            <span className="mt-2 text-[13px] font-semibold text-ink">
              {busy ? "Uploading…" : "Choose a photo"}
            </span>
            <span className="mt-0.5 text-[11.5px] text-ink3">JPG, PNG or HEIC</span>
          </>
        )}
      </label>

      {error ? <ErrorLine>{error}</ErrorLine> : null}

      {staged ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className={`${BTN_GHOST} cursor-pointer`}>
            <input
              type="file"
              accept="image/*"
              onChange={handleFile}
              disabled={busy}
              className="sr-only"
            />
            {busy ? "Uploading…" : "Choose a different photo"}
          </label>
          <button type="button" onClick={() => onSelect(staged)} className={BTN_PRIMARY}>
            Use this photo
          </button>
        </div>
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
  // Curated Memory Stamp style vs freeform prompting. Stamp mode ignores the
  // textarea (the server-side style prompt IS the prompt) and requires a
  // photo — there is no subject to stamp without one.
  const [stampMode, setStampMode] = useState(
    current?.prompt === MEMORY_STAMP_SENTINEL,
  );

  if (!isSignedIn) return <SignInGate label="AI labels" />;

  const trimmed = stampMode ? MEMORY_STAMP_SENTINEL : prompt.trim();
  const overLimit = !stampMode && prompt.length > AI_PROMPT_MAX_LEN;
  const canSubmit = stampMode
    ? refDataUri !== null || current?.prompt === MEMORY_STAMP_SENTINEL
    : trimmed.length > 0 && !overLimit;

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
      // Shrink before it ever rides in a JSON body — Vercel rejects bodies
      // around 4.5 MB at the platform layer, so a full-size phone photo
      // never even reached our route (it 413'd, the catch handler cleared
      // the slot, and the stamp silently became a lucky cat).
      setRefDataUri(await downscaleDataUriForAi(dataUri));
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
      style: stampMode ? MEMORY_STAMP_STYLE_ID : undefined,
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

  const modeChip = (active: boolean) =>
    `flex-1 rounded-full px-3 py-2 text-[12.5px] font-semibold transition ${
      active
        ? "border border-brand bg-cream text-brand"
        : "border border-line bg-card text-ink2 hover:border-ink4"
    }`;

  return (
    <div className="flex flex-col gap-4">
      {/* Style switch: freeform prompting vs the curated Memory Stamp. */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setStampMode(false)}
          aria-pressed={!stampMode}
          className={modeChip(!stampMode)}
        >
          ✨ Describe it
        </button>
        <button
          type="button"
          onClick={() => setStampMode(true)}
          aria-pressed={stampMode}
          className={modeChip(stampMode)}
        >
          🧧 Memory Stamp
        </button>
      </div>

      {stampMode ? (
        <p className="text-[12.5px] leading-relaxed text-ink3">
          Upload a photo and we&apos;ll press its subject into a vintage
          ink-stamp keepsake — printed right on your cup. Pets, friends,
          holiday snaps all work; faces stay true.
        </p>
      ) : (
        <div>
          <label htmlFor="ai-prompt" className={EYEBROW}>
            Describe your design
          </label>
          <textarea
            id="ai-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={AI_PROMPT_MAX_LEN + 50}
            rows={3}
            placeholder="e.g. two cats reading on a moon, line drawing"
            className={`${FIELD} mt-1.5 resize-none`}
          />
          <div className="mt-1 flex items-center justify-between text-[11.5px]">
            <span className="text-ink3">Printed in black ink — simple shapes come out best.</span>
            <span className={overLimit ? "font-semibold text-red-600" : "text-ink4"}>
              {prompt.length}/{AI_PROMPT_MAX_LEN}
            </span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        {refDataUri ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={refDataUri}
            alt="Reference image preview"
            className="h-14 w-14 shrink-0 rounded-tile border border-line object-cover"
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${BTN_GHOST} cursor-pointer`}>
            <input
              type="file"
              accept="image/*"
              onChange={handleRefFile}
              className="sr-only"
            />
            📎{" "}
            {refDataUri
              ? stampMode
                ? "Change photo"
                : "Change reference image"
              : stampMode
                ? "Add your photo (required)"
                : "Add a reference image (optional)"}
          </label>
          {refDataUri ? (
            <button
              type="button"
              onClick={() => setRefDataUri(null)}
              className="text-[12px] font-medium text-ink3 underline underline-offset-2 hover:text-red-600"
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>

      {error ? <ErrorLine>{error}</ErrorLine> : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11.5px] text-ink3">
          Takes about half a minute — you can keep checking out meanwhile.
        </p>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!canSubmit}
          className={BTN_PRIMARY}
        >
          ✨ Generate
        </button>
      </div>
    </div>
  );
}

function DrawTab({
  isSignedIn,
  slotKey,
  onPathsChange,
  onSelect,
}: {
  isSignedIn: boolean;
  slotKey: string;
  /** Mirrors the strokes up to the picker so the sticker preview draws
   *  along. */
  onPathsChange: (paths: SvgPath[]) => void;
  onSelect: (sel: Extract<CupLabelSelection, { kind: "draw" }>) => void;
}) {
  const [paths, setPathsState] = useState<SvgPath[]>([]);
  const [brush, setBrush] = useState<BrushWidth>(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isSignedIn) return <SignInGate label="drawn labels" />;

  // Force a fresh canvas whenever the user picks a different cup —
  // otherwise the prior cup's strokes bleed in via shared state.
  // slotKey changes per cup, so reset on its change.
  // (LabelPicker already remounts the tab body when `tab` flips, but
  // not when slotKey changes within an open dialog — guard here.)
  // Note: intentionally not pulling slotKey into state — using it as
  // the React `key` on the canvas would force a remount on slot
  // change. The LabelPicker reopens the dialog per cup so slotKey is
  // stable for the lifetime of this component.

  function setPaths(next: SvgPath[]) {
    setPathsState(next);
    onPathsChange(next);
  }

  function handleUndo() {
    if (paths.length === 0) return;
    setPaths(paths.slice(0, -1));
  }

  function handleClear() {
    setPaths([]);
    setError(null);
  }

  async function handleUse() {
    if (paths.length === 0 || busy) return;
    setError(null);
    setBusy(true);
    try {
      const { userDoodleId } = await uploadDrawingForCupLabel(paths);
      onSelect({ kind: "draw", userDoodleId, pathCount: paths.length });
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

  const _slotKey = slotKey;
  void _slotKey;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={EYEBROW}>Brush</span>
          {BRUSHES.map((w) => {
            const active = brush === w;
            return (
              <button
                key={w}
                type="button"
                onClick={() => setBrush(w)}
                className={`flex h-9 w-9 items-center justify-center rounded-full border bg-card transition ${
                  active ? "border-2 border-brand" : "border-line hover:border-ink4"
                }`}
                aria-pressed={active}
                aria-label={`Brush size ${w}`}
              >
                <span
                  className="inline-block rounded-full bg-ink"
                  style={{ width: w + 2, height: w + 2 }}
                />
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleUndo}
            disabled={paths.length === 0 || busy}
            className={BTN_GHOST}
          >
            Undo
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={paths.length === 0 || busy}
            className={BTN_GHOST}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[360px]">
        <DrawCanvas paths={paths} brushWidth={brush} onPathsChange={setPaths} />
      </div>

      {error ? <ErrorLine>{error}</ErrorLine> : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11.5px] text-ink3">
          {paths.length === 0
            ? "Draw with a finger, mouse or pen. It prints in black ink."
            : "Watch it land on the sticker as you go."}
        </p>
        <button
          type="button"
          onClick={handleUse}
          disabled={paths.length === 0 || busy}
          className={BTN_PRIMARY}
        >
          {busy ? "Saving…" : "Use this drawing"}
        </button>
      </div>
    </div>
  );
}

function SignInGate({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center rounded-tile border border-dashed border-line bg-bg/60 px-5 py-8 text-center">
      <span className="text-2xl" aria-hidden="true">
        🔒
      </span>
      <p className="mt-2 text-[14px] font-semibold text-ink">Sign in for {label}</p>
      <p className="mt-1 max-w-[280px] text-[12.5px] text-ink3">
        Your designs are saved to your account so they print on the right cup
        — and so we can find them again for you.
      </p>
      <a href="/account" className={`${BTN_PRIMARY} mt-4`}>
        Sign in
      </a>
    </div>
  );
}
