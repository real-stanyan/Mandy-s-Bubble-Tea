# Web cup-label: Port Photo + AI tabs (parity with RN app DoodleModal)

**Date**: 2026-05-21
**Branch**: `feat/cup-label-zebra-zd410`
**Builds on**: `2026-05-21-cup-label-fortune-precompute.md` (POS fortune)
+ same-session web wire fix (cart algo align + `presetStickerHashes` enqueue
branch)

## Problem

Web checkout's `LabelPicker` currently only supports the static 78-sticker
preset gallery. The RN app already ships three additional cup-label
sources via `DoodleModal` (Draw / AI / Photo). Customers ordering from
the web cannot upload their own photo or generate an AI image, so the
"surprise on your cup" + "your own photo on your cup" features are
mobile-only — a parity gap that blocks Stan rolling web as the primary
checkout surface.

## Scope

Add two new sources to the web `LabelPicker`:

1. **Upload Photo** — pick a file from device, server binarises to 1-bit
   thermal, returns an opaque id.
2. **AI Generate** — submit prompt (+ optional reference image), server
   kicks off Doubao Seedream 4 in background, returns id immediately
   (no client-visible preview — "surprise on your cup" UX, mirrors RN).

The static **Gallery** tab (78 stickers, auto-random) stays.

**Out of scope**: `Draw` (RN's `DoodleCanvas` SVG paint surface) —
explicit YAGNI per Stan; mouse-based painting on web is a poor
experience compared to touch, and the existing server `doodleIds` branch
keeps working if we add it later.

## Non-goals

- No change to server `/api/cup-label/upload-image` and
  `/api/cup-label/ai-submit` route bodies — both already accept the
  exact contract RN uses.
- No change to `enqueueCupLabelJobs` AI/photo branch — both web-uploaded
  photos and web-AI-generated images converge into `aiDoodleIds` at
  payment-submit time, same as RN.
- No migration of historical `cup_label_jobs` rows — discriminated-union
  cart shape applies only to in-flight selections.

## User stories

- **Photo**: Authed customer on `/checkout` opens `LabelPicker` for cup
  1, taps `📷 Photo`, picks an image from device, sees the 1-bit
  binarised preview, taps `Use this photo`. Cup 1 row shows
  "📷 Your photo". On `Pay`, ZD410 prints the binarised version.
- **AI**: Authed customer taps `✨ AI`, types prompt "two cats reading
  on a moon", optionally attaches a reference selfie, taps `Generate`.
  Modal shows "Submitted — your AI image will be a surprise on your
  cup". Cup row shows "✨ AI · two cats reading on a m…". On `Pay`,
  ZD410 prints whatever Doubao produced (server-side async pipeline).
- **Mixed cart**: 3-cup line; cup 0 stays auto-random gallery, cup 1
  becomes user photo, cup 2 becomes AI. All three sources coexist in
  the same cart, each independently keyed.
- **Unauthed customer**: Photo / AI tabs greyed out with "Sign in to
  use these"; Gallery still works (78 preset stickers are public assets).

## Server contract (unchanged, documented for reference)

### POST /api/cup-label/upload-image
Request:
```json
{ "imageBase64": "data:image/jpeg;base64,..." }
```
Response (success):
```json
{ "ok": true, "uploadedDoodleId": "<uuid>", "previewUrl": "https://..." }
```
Errors: 401 (sign-in required), 400 (empty/invalid image), 413
(> 8 MB).

### POST /api/cup-label/ai-submit
Request:
```json
{
  "slotKey": "<clientLineId>:<cupIdx>",
  "prompt": "two cats reading on a moon",
  "sourceImageBase64": "data:image/...",       // optional
  "cartSessionId": "<uuid from cart store>"     // required for new clients
}
```
Response (success):
```json
{ "ok": true, "aiDoodleId": "<uuid>", "status": "pending|ready|failed", "reused": false }
```
Errors: 401, 400 (missing slotKey/prompt), 400 (prompt > 200 chars),
413 (source > 8 MB).

### POST /api/payment (extension)
Adds an optional field already wired in the prior cart-algo-align fix:
```json
{
  "sourceId": "...",
  "orderId": "...",
  "verificationToken": "...",
  "presetStickerHashes": { "<slotKey>": "<md5>" },
  "aiDoodleIds": { "<slotKey>": "<uuid>" }
}
```
`aiDoodleIds` already accepted by `payment/route.ts` (line 92-97). The
client side currently sends only `presetStickerHashes`; this change
extends it to also send `aiDoodleIds` derived from the new union.

## Client architecture

### Cart store (`src/store/cart.ts`)

**Current shape:**
```ts
labelSelections: Record<string, string>  // cupKey → gallery md5 hash
```

**New shape:**
```ts
type CupLabelSelection =
  | { kind: "preset"; hash: string }                       // 78-sticker gallery
  | { kind: "photo"; uploadedDoodleId: string; previewUrl: string }
  | { kind: "ai"; aiDoodleId: string; prompt: string };

labelSelections: Record<string, CupLabelSelection>;
cartSessionId: string;  // UUID v4, generated on first store hydrate, regenerated on clear()
```

**zustand persist**: bump `version` from 0 → 1. Migration: drop all
existing `labelSelections` entries (cart is currently empty in dev; in
prod, auto-random will refill on `/checkout` mount). Set
`cartSessionId = crypto.randomUUID()` on first load post-migration.

**Helpers (already exist, signatures unchanged):**
- `cupKey(lineId, cupIdx) → "${lineId}:${cupIdx}"` (single colon — matches server slotKey)
- `setLabel(cupKey, CupLabelSelection)` (value type widens)
- `clearLabel(cupKey)`
- `clear()` → also regenerate cartSessionId

### Client helper module (`src/lib/cup-label/client.ts`, new)

Mirrors RN `lib/doodle/{uploadImage.ts, aiGenerate.ts}` exports but uses
browser `fetch`. Exports:

```ts
export async function uploadPhotoForCupLabel(file: File): Promise<{
  uploadedDoodleId: string;
  previewUrl: string;
}>;

export async function submitAiCupLabel(args: {
  slotKey: string;
  prompt: string;
  sourceImageBase64?: string;
  cartSessionId: string;
}): Promise<{
  aiDoodleId: string;
  status: "pending" | "ready" | "failed";
  reused: boolean;
}>;

export function readFileAsDataUri(file: File): Promise<string>;
```

Errors throw with `instanceof Error` carrying a human-readable message
(the LabelPicker surfaces `.message` directly to the user).

### LabelPicker (`src/components/checkout/LabelPicker.tsx`)

**Current**: Radix Dialog with a single 3-col / 4-col / 5-col grid of
gallery thumbnails.

**New**: Same Dialog, plus a 3-tab bar at the top.

```
┌─────────────────────────────────────┐
│ [ 🎨 Gallery ][ 📷 Photo ][ ✨ AI ]  │  ← Tab bar (segmented control)
├─────────────────────────────────────┤
│                                     │
│  <tab body>                         │
│                                     │
└─────────────────────────────────────┘
```

- **Gallery tab** (default if current selection is `preset` or no
  selection): existing grid, click → `setLabel(cupKey, { kind: "preset", hash })`.
- **Photo tab**:
  - `<input type="file" accept="image/*" capture="environment">` (camera
    on mobile, file picker on desktop).
  - `onChange` → check size cap (8 MB client-side) → `readFileAsDataUri`
    → POST `/api/cup-label/upload-image` → show binarised
    `previewUrl` thumbnail (large, single image, not a grid) → `Use this
    photo` button commits to cart.
  - "Choose different photo" link resets state.
  - Auth-gated: if `useAuth().profile == null`, show "Sign in to use
    Photo" with link to `/account`.
- **AI tab**:
  - `<textarea maxLength={200}>` for prompt, char count.
  - Optional reference image: same `<input type="file">` pattern,
    base64-encoded inline, **not uploaded** — sent inside the `ai-submit`
    body as `sourceImageBase64`.
  - `Generate` button (disabled when prompt empty): POST
    `/api/cup-label/ai-submit` with `slotKey`, `prompt`,
    `sourceImageBase64?`, `cartSessionId`.
  - On success: `setLabel(cupKey, { kind: "ai", aiDoodleId, prompt })` +
    show "✨ Submitted! Your AI image will be a surprise on your cup."
    No preview shown.
  - Auth-gated same as Photo.

Tab state is local to the picker (not persisted). Initial tab derived
from current selection `kind`.

### CupLabelSection (`src/components/checkout/CupLabelSection.tsx`)

Per-cup row summary now switches by `selection.kind`:

```ts
function summaryFor(sel: CupLabelSelection | undefined): string {
  if (!sel) return "Pick a design";
  if (sel.kind === "preset") return `🎨 ${sel.hash.slice(0, 8)}…`;
  if (sel.kind === "photo") return "📷 Your photo";
  return `✨ AI · ${sel.prompt.slice(0, 32)}${sel.prompt.length > 32 ? "…" : ""}`;
}
```

Thumbnail rendering:
- `preset` → existing binarised gallery image (`/cup-label/gallery/<hash>/binarized.png`).
- `photo` → `selection.previewUrl` (signed Storage URL).
- `ai` → placeholder `✨` icon with caption "AI · pending" (no preview).

Auto-random behaviour (the `useRef<Set<cupKey>>` effect) stays — but
only fills empty slots and never overwrites a `photo`/`ai` choice.

### Checkout submit (`src/app/checkout/page.tsx`)

Replace the single `presetStickerHashes` build with the union split:

```ts
const presetStickerHashes: Record<string, string> = {};
const aiDoodleIds: Record<string, string> = {};
for (const [cupKey, sel] of Object.entries(labelSelections)) {
  if (sel.kind === "preset") presetStickerHashes[cupKey] = sel.hash;
  else if (sel.kind === "photo") aiDoodleIds[cupKey] = sel.uploadedDoodleId;
  else aiDoodleIds[cupKey] = sel.aiDoodleId;
}

const paymentBody = {
  sourceId: sourceToken,
  orderId: orderJson.orderId,
  verificationToken,
  presetStickerHashes: Object.keys(presetStickerHashes).length ? presetStickerHashes : undefined,
  aiDoodleIds: Object.keys(aiDoodleIds).length ? aiDoodleIds : undefined,
};
```

Photo and AI both feed `aiDoodleIds` because the server's `loadAiDoodleUpload`
helper already reads from the same Storage path regardless of which
upstream produced the row (existing behaviour; see RN app's
`lib/doodle/uploadImage.ts` header comment).

## Error handling

| Failure mode | UX |
|--------------|-----|
| Photo > 8 MB | Client-side reject before POST; toast "Image too large (max 8 MB)" |
| Photo POST 401 | "Sign in to use Photo" + `/account` link |
| Photo POST 5xx | Toast `e.message`, picker stays open, choice not committed |
| AI prompt empty | `Generate` button disabled |
| AI prompt > 200 | Char counter goes red; `Generate` disabled |
| AI POST 401/4xx/5xx | Toast `e.message`, no commit |
| AI `reused: true` | Same UX as fresh — `aiDoodleId` re-fetched, prompt overwrites old |
| Auth race (user signs out mid-flow) | Next POST 401 surfaces normally |
| Network offline | `fetch` rejection → toast "Network error, please retry" |

## Testing

**Unit (vitest)**
- `src/store/cart.test.ts` (new or extend existing): union setLabel
  round-trip, persistence migration v0→v1 drops legacy hash-string
  entries, `clear()` regenerates `cartSessionId`.
- `src/lib/cup-label/client.test.ts` (new): `uploadPhotoForCupLabel`
  POST shape, `submitAiCupLabel` body shape (incl. `cartSessionId`),
  error mapping. fetch mocked via `vi.spyOn(globalThis, "fetch")`.

**Targeted manual smoke (Stan, live)**
1. Gallery only — submit, verify `cup_label_jobs.doodle_source = preset_sticker`, ZD410 prints chosen hash.
2. Photo only — upload selfie, submit, verify `doodle_source = ai`, `original_image_path` points at uploaded PNG, ZD410 prints binarised photo.
3. AI only — prompt "cute boba", submit, verify `doodle_source = ai`, prompt stored in `cup_label_ai_jobs.prompt`, ZD410 prints Doubao output.
4. Mixed 3-cup line — one per kind, all three rows present in cup_label_jobs with correct sources.

## Risks & open questions

- **Storage quota**: every web user upload now hits Supabase Storage
  `doodles` bucket. RN app already does this; web only adds users who
  weren't using the app. Existing 8 MB cap + per-cup-slot UNIQUE on
  `cup_label_ai_jobs` limit blast radius. **Mitigation**: defer signed-URL
  TTL tightening to a follow-up if usage spikes.
- **Doubao latency**: `after()` is fire-and-forget — if Doubao is down,
  ZD410 prints a hash-default fallback (existing `enqueueCupLabelJobs`
  catch on `loadAiDoodleUpload`). The customer sees no error because
  they were told it's a "surprise."
- **camera permission on iOS Safari**: `<input capture>` UX is
  inconsistent across browsers. Falling back to library is acceptable;
  no special handling required.
- **iOS Safari `crypto.randomUUID()`**: supported since iOS 15.4 (April
  2022). Below that, fallback to a 16-byte hex string. Negligible
  exposure window in 2026.

## Out-of-scope follow-ups

- Draw tab (mouse SVG canvas) if Stan wants full RN parity later.
- Saved Photos / AI history reuse across carts (currently
  `cartSessionId`-scoped, can be unscoped if marketing wants).
- Per-cup AI "regenerate this one with different prompt" — current spec
  is one-shot per slot key; reusing the same slot returns the existing
  id (server idempotency).
