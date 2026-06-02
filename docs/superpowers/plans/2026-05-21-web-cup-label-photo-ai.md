# Web cup-label: Port Photo + AI tabs to web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the web `LabelPicker` with two new cup-design sources (user photo upload + Doubao AI generation) so the web checkout reaches feature parity with the RN app's `DoodleModal`.

**Architecture:** Cart `labelSelections` value evolves from `string` (gallery hash) into a discriminated union of three kinds (`preset` / `photo` / `ai`). Two new client helpers wrap the existing server routes `/api/cup-label/upload-image` and `/api/cup-label/ai-submit`. The picker grows a tab bar; cup-label rows render different thumbnails + summaries by kind; the checkout submitter splits the union into two parallel payload maps (`presetStickerHashes` + `aiDoodleIds`) that the server already accepts.

**Tech Stack:** Next 16 (Turbopack), TypeScript strict, Zustand 5 (cart store, `persist` + `createJSONStorage`), Radix UI Dialog, Tailwind, vitest 4 (test runner), Mandy Supabase project `fsvtwivogyebugqhmjjy` (storage bucket `doodles` already configured).

**Working directory:** `~/Github/mandys_bubble_tea` (primary worktree, currently on `feat/cup-label-zebra-zd410`).

**Spec:** `docs/superpowers/specs/2026-05-21-web-cup-label-photo-ai.md`.

---

## Pre-flight (state right now)

This branch already carries the cup-label wire fix from earlier in the session — those modified files are the foundation this plan builds on. Verify state before Task 1 and commit the foundation as a separate commit so the photo/AI work lives on a clean baseline.

- [ ] **Step 0a: Confirm uncommitted wire-fix changes**

Run:
```bash
cd ~/Github/mandys_bubble_tea
git status -s
```

Expected to see (among others):
```
 M src/app/api/payment/route.ts
 M src/app/checkout/page.tsx
 M src/lib/cup-label/enqueue.ts
 M src/store/cart.ts
?? docs/superpowers/specs/2026-05-21-web-cup-label-photo-ai.md
?? docs/superpowers/plans/2026-05-21-web-cup-label-photo-ai.md
```

If `package.json` appears modified, run `git diff package.json` — if the only delta is whitespace / dependency reorder triggered by `npm install`, run `git checkout package.json` to revert. Real dependency additions in this plan happen only inside specific tasks.

- [ ] **Step 0b: Commit the wire-fix baseline + spec/plan**

```bash
cd ~/Github/mandys_bubble_tea
git add \
  src/app/api/payment/route.ts \
  src/app/checkout/page.tsx \
  src/lib/cup-label/enqueue.ts \
  src/store/cart.ts \
  docs/superpowers/specs/2026-05-21-web-cup-label-photo-ai.md \
  docs/superpowers/plans/2026-05-21-web-cup-label-photo-ai.md
git commit -m "feat(cup-label): wire presetStickerHashes end-to-end + align cart algo with server/RN

- cart.signatureFor/cupKey now mirror RN buildLineId + server clientLineIdFromSquareLine
- payment route accepts presetStickerHashes
- enqueue.ts adds preset_sticker source backed by static gallery PNG
- DB migration extends doodle_source CHECK with 'preset_sticker' (already applied)

Plus design docs for the photo + AI port (next plan)."
```

Don't push yet — the rest of the plan stacks more commits on this branch.

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `src/store/cart.ts` | Modify | `labelSelections` value becomes `CupLabelSelection` union; add `cartSessionId`; persist `version` 0 → 1 with migration; widen `setLabel` signature; `clear()` regenerates session id |
| `src/store/__tests__/cart-label-selections.test.ts` | Create | Round-trip three kinds, persistence migration v0→v1 drops legacy hash strings, `clear()` regenerates `cartSessionId`, prune helpers still match by single-colon prefix |
| `src/lib/cup-label/client.ts` | Create | Browser-side wrappers: `uploadPhotoForCupLabel(file)`, `submitAiCupLabel(args)`, `readFileAsDataUri(file)` |
| `src/lib/cup-label/client.test.ts` | Create | Request shape, error mapping, size cap for each helper (fetch + FileReader mocked) |
| `src/components/checkout/LabelPicker.tsx` | Modify | Accept `CupLabelSelection` instead of `string`; render 3-tab bar; preserve Gallery body; add Photo body + AI body |
| `src/components/checkout/CupLabelSection.tsx` | Modify | Per-cup thumbnail + summary dispatch by `selection.kind`; auto-random fills only when `selection` is absent (not when present-but-non-preset) |
| `src/components/checkout/cup-label-summary.ts` | Create | Pure `summaryFor(selection)` used by `CupLabelSection`; isolated for unit test |
| `src/components/checkout/__tests__/cup-label-summary.test.ts` | Create | Pure-fn test for the four branches (undefined/preset/photo/ai) |
| `src/app/checkout/page.tsx` | Modify | Replace single `presetStickerHashes` build with `buildPaymentSelections(labelSelections)` splitter; POST both `presetStickerHashes` and `aiDoodleIds` |
| `src/lib/cup-label/build-payment-selections.ts` | Create | Pure splitter `(labelSelections) → { presetStickerHashes, aiDoodleIds }` |
| `src/lib/cup-label/build-payment-selections.test.ts` | Create | Empty / only preset / only photo / only ai / mixed |

---

## Task 1: Cart store — discriminated union + cartSessionId + persist v1

**Files:**
- Modify: `src/store/cart.ts`
- Create: `src/store/__tests__/cart-label-selections.test.ts`

- [ ] **Step 1: Read current cart.ts to confirm baseline**

```bash
cd ~/Github/mandys_bubble_tea
grep -n 'labelSelections\|setLabel\|cartSessionId\|persist(' src/store/cart.ts
```
Expected: `labelSelections: Record<string, string>` on line ~37; `setLabel(key, galleryHash)` on line ~173; no `cartSessionId` yet; `persist(` block around line 115; no `version` field yet (zustand persist defaults to `0`).

- [ ] **Step 2: Write the failing test**

Create `src/store/__tests__/cart-label-selections.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Reset zustand persist + module state between tests so each it() gets a
// fresh store with an empty mocked localStorage.
let setItemSpy: ReturnType<typeof vi.fn>;
let store: Record<string, string>;

function installLocalStorageMock(seed: Record<string, string> = {}) {
  store = { ...seed };
  setItemSpy = vi.fn((key: string, value: string) => {
    store[key] = value;
  });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: setItemSpy,
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: () => null,
    length: 0,
  });
}

beforeEach(() => {
  vi.resetModules();
  installLocalStorageMock();
  // crypto.randomUUID is available in Node 19+; the test asserts on shape,
  // not the exact value.
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cart labelSelections union", () => {
  it("setLabel accepts kind:preset", async () => {
    const { useCart, cupKey } = await import("@/store/cart");
    const key = cupKey("VAR123::MOD1,MOD2", 0);
    useCart.getState().setLabel(key, { kind: "preset", hash: "abc123" });
    const sel = useCart.getState().labelSelections[key];
    expect(sel).toEqual({ kind: "preset", hash: "abc123" });
  });

  it("setLabel accepts kind:photo", async () => {
    const { useCart, cupKey } = await import("@/store/cart");
    const key = cupKey("VAR123::", 0);
    useCart.getState().setLabel(key, {
      kind: "photo",
      uploadedDoodleId: "00000000-0000-0000-0000-000000000001",
      previewUrl: "https://example/preview.png",
    });
    expect(useCart.getState().labelSelections[key]).toMatchObject({
      kind: "photo",
      uploadedDoodleId: "00000000-0000-0000-0000-000000000001",
    });
  });

  it("setLabel accepts kind:ai", async () => {
    const { useCart, cupKey } = await import("@/store/cart");
    const key = cupKey("VAR123::", 0);
    useCart.getState().setLabel(key, {
      kind: "ai",
      aiDoodleId: "00000000-0000-0000-0000-000000000002",
      prompt: "cats reading on a moon",
    });
    expect(useCart.getState().labelSelections[key]).toMatchObject({
      kind: "ai",
      prompt: "cats reading on a moon",
    });
  });

  it("clear() regenerates cartSessionId and empties labelSelections", async () => {
    const { useCart } = await import("@/store/cart");
    const before = useCart.getState().cartSessionId;
    expect(before).toMatch(/^[0-9a-f-]{36}$/i);
    useCart.getState().setLabel("k:0", { kind: "preset", hash: "x" });
    useCart.getState().clear();
    const after = useCart.getState().cartSessionId;
    expect(after).toMatch(/^[0-9a-f-]{36}$/i);
    expect(after).not.toBe(before);
    expect(useCart.getState().labelSelections).toEqual({});
  });

  it("persist v0 → v1 migration drops legacy hash-string entries", async () => {
    // Seed localStorage with a v0 payload (labelSelections: Record<string,string>).
    installLocalStorageMock({
      "mandy-cart": JSON.stringify({
        state: {
          lines: [],
          labelSelections: { "VAR::": "abc123" },
        },
        version: 0,
      }),
    });
    const { useCart } = await import("@/store/cart");
    // Force rehydrate so the migration runs against our seeded payload.
    useCart.persist.rehydrate();
    const s = useCart.getState();
    expect(s.labelSelections).toEqual({});
    expect(s.cartSessionId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("prune helpers strip selections by single-colon prefix", async () => {
    const { useCart } = await import("@/store/cart");
    useCart.getState().setLabel("LINE_A:0", { kind: "preset", hash: "a" });
    useCart.getState().setLabel("LINE_A:1", { kind: "preset", hash: "b" });
    useCart.getState().setLabel("LINE_B:0", { kind: "preset", hash: "c" });
    // setQuantity(LINE_A, 0) removes line A and all its selections.
    useCart.setState((s) => ({
      lines: [
        ...s.lines,
        {
          id: "LINE_A",
          itemId: "X",
          itemName: "x",
          itemImageUrl: null,
          variationId: "V",
          variationName: "v",
          variationPriceCents: 0n,
          modifiers: [],
          quantity: 1,
        },
      ],
    }));
    useCart.getState().setQuantity("LINE_A", 0);
    expect(useCart.getState().labelSelections).toEqual({
      "LINE_B:0": { kind: "preset", hash: "c" },
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd ~/Github/mandys_bubble_tea
npx vitest run src/store/__tests__/cart-label-selections.test.ts --reporter=default
```
Expected: FAIL on every test — `setLabel` signature still takes `(key, galleryHash: string)`, `cartSessionId` is undefined, no v0→v1 migrator.

- [ ] **Step 4: Edit `src/store/cart.ts` — types, state shape, persist v1**

Edit `src/store/cart.ts`. Apply the following changes in order:

(a) Add the union type at the top, after the existing `CartLineModifier`/`CartLine` definitions (around line 28):

```ts
/** Per-cup label selection. Discriminated by `kind`. Stored in
 *  `labelSelections` under key `cupKey(lineId, cupIdx)`. Stays in sync
 *  with the RN app's `DoodleSlot` source priority (ai > photo > preset).
 */
export type CupLabelSelection =
  | { kind: "preset"; hash: string }
  | { kind: "photo"; uploadedDoodleId: string; previewUrl: string }
  | { kind: "ai"; aiDoodleId: string; prompt: string };
```

(b) Replace the `labelSelections` field in `CartState` (currently `Record<string, string>`) and add `cartSessionId`. Also widen `setLabel`:

```ts
  // Per-cup gallery / photo / AI selection. Key = cupKey
  // (`${lineId}:${cupIdx}`, 0-indexed), value = discriminated union of
  // the three source kinds. Matches the server `slotKey` exactly so
  // labelSelections forwards verbatim into payment payload maps.
  labelSelections: Record<string, CupLabelSelection>;

  /** Scopes the per-slot AI submission quota on the server (see
   *  `/api/cup-label/ai-submit`). Regenerated on `clear()` so a new
   *  shopping session never inherits the previous cart's AI image. */
  cartSessionId: string;

  // Actions
  addLine: (line: Omit<CartLine, "id" | "quantity">, quantity?: number) => void;
  setQuantity: (lineId: string, quantity: number) => void;
  removeLine: (lineId: string) => void;
  clear: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  setLabel: (cupKey: string, selection: CupLabelSelection) => void;
  clearLabel: (cupKey: string) => void;
```

(c) Add a session-id generator helper above the store (right after `signatureFor`):

```ts
/** UUID v4 with a graceful fallback for old Safari (pre-iOS 15.4). */
function newCartSessionId(): string {
  const c =
    typeof globalThis !== "undefined" && "crypto" in globalThis
      ? (globalThis.crypto as Crypto)
      : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fallback: 16 random bytes hex. Not RFC-shaped but unique enough for
  // session scoping; server doesn't validate UUID v4 specifically.
  const buf = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(buf);
  else for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
```

(d) Update the initial state and `clear()` inside the store factory:

```ts
      lines: [],
      isOpen: false,
      hydrated: false,
      labelSelections: {},
      cartSessionId: newCartSessionId(),
```

```ts
      clear: () =>
        set({
          lines: [],
          labelSelections: {},
          cartSessionId: newCartSessionId(),
        }),
```

(e) Update `setLabel` to take a union value:

```ts
      setLabel: (key, selection) =>
        set((state) => ({
          labelSelections: { ...state.labelSelections, [key]: selection },
        })),
```

(f) Update the `persist` config block to add `version` + `migrate` + persist `cartSessionId`:

```ts
    {
      name: "mandy-cart",
      version: 1,
      storage: createJSONStorage(() => localStorage, {
        replacer: (_key, value) =>
          typeof value === "bigint"
            ? { __bigint: value.toString() }
            : value,
        reviver: (_key, value) => {
          if (
            value &&
            typeof value === "object" &&
            "__bigint" in value &&
            typeof (value as { __bigint: unknown }).__bigint === "string"
          ) {
            return BigInt((value as { __bigint: string }).__bigint);
          }
          return value;
        },
      }),
      migrate: (persistedState: unknown, fromVersion: number) => {
        // v0 stored labelSelections as Record<string, string> (gallery
        // hash). The new union shape isn't compatible — drop legacy
        // entries; auto-random refill will repopulate on next checkout
        // mount. Always emit a fresh cartSessionId so the AI quota
        // doesn't carry over from a prior cart.
        const next = (
          persistedState && typeof persistedState === "object"
            ? { ...(persistedState as Record<string, unknown>) }
            : {}
        ) as Partial<CartState>;
        if (fromVersion < 1) {
          next.labelSelections = {};
        }
        next.cartSessionId = newCartSessionId();
        return next as CartState;
      },
      partialize: (state) => ({
        lines: state.lines,
        labelSelections: state.labelSelections,
        cartSessionId: state.cartSessionId,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    },
```

- [ ] **Step 5: Run the new test — it should pass**

```bash
cd ~/Github/mandys_bubble_tea
npx vitest run src/store/__tests__/cart-label-selections.test.ts --reporter=default
```
Expected: 6 passed.

- [ ] **Step 6: Run the rest of the cart-touching suite to catch regressions**

```bash
cd ~/Github/mandys_bubble_tea
npx vitest run src/store/__tests__/ src/lib/cup-label/ --reporter=default
```
Expected: no new failures vs the previous run. The pre-existing `surcharge.test.ts` and `cup-label/enqueue.test.ts` shouldn't have changed.

- [ ] **Step 7: Run tsc — type errors at every call site of `setLabel`**

```bash
cd ~/Github/mandys_bubble_tea
npx tsc --noEmit 2>&1 | grep -v 'scripts/dump-bitmap-png\|vitest.contract.config' | head -10
```
Expected: errors at `src/components/checkout/CupLabelSection.tsx` and `src/components/checkout/LabelPicker.tsx` because they still pass strings. These are fixed in later tasks; leave them for now.

- [ ] **Step 8: Commit**

```bash
git add src/store/cart.ts src/store/__tests__/cart-label-selections.test.ts
git commit -m "refactor(cart): discriminated-union labelSelections + cartSessionId

- CupLabelSelection union: preset | photo | ai
- New cartSessionId field, regenerated on clear()
- zustand persist v0 → v1 migrate drops legacy hash-string entries
- setLabel signature widens; prune helpers untouched (already keyed by
  single-colon prefix)

CupLabelSection + LabelPicker still typecheck-error at call sites; fixed
in subsequent tasks."
```

---

## Task 2: Client helpers (`uploadPhotoForCupLabel`, `submitAiCupLabel`, `readFileAsDataUri`)

**Files:**
- Create: `src/lib/cup-label/client.ts`
- Create: `src/lib/cup-label/client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/cup-label/client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readFileAsDataUri,
  uploadPhotoForCupLabel,
  submitAiCupLabel,
  CupLabelClientError,
} from "./client";

let fetchSpy: ReturnType<typeof vi.spyOn>;

function mockFetchOnce(body: object, status = 200) {
  fetchSpy.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("readFileAsDataUri", () => {
  it("returns a data: URI", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" });
    const uri = await readFileAsDataUri(file);
    expect(uri).toMatch(/^data:image\/png;base64,/);
  });
});

describe("uploadPhotoForCupLabel", () => {
  it("POSTs the data URI and returns the uploadedDoodleId + previewUrl", async () => {
    mockFetchOnce({
      ok: true,
      uploadedDoodleId: "11111111-2222-3333-4444-555555555555",
      previewUrl: "https://example/preview.png",
    });
    const file = new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" });
    const result = await uploadPhotoForCupLabel(file);
    expect(result).toEqual({
      uploadedDoodleId: "11111111-2222-3333-4444-555555555555",
      previewUrl: "https://example/preview.png",
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/cup-label/upload-image");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).imageBase64).toMatch(/^data:image\/png;base64,/);
  });

  it("rejects files larger than 8 MB before POSTing", async () => {
    const big = new File([new Uint8Array(9 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" });
    await expect(uploadPhotoForCupLabel(big)).rejects.toThrow(/too large/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws CupLabelClientError on server 4xx", async () => {
    mockFetchOnce({ ok: false, error: "Sign in required" }, 401);
    const file = new File([new Uint8Array([1])], "x.png", { type: "image/png" });
    await expect(uploadPhotoForCupLabel(file)).rejects.toBeInstanceOf(CupLabelClientError);
  });
});

describe("submitAiCupLabel", () => {
  it("POSTs the prompt + cartSessionId and returns the aiDoodleId", async () => {
    mockFetchOnce({
      ok: true,
      aiDoodleId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      status: "pending",
      reused: false,
    });
    const result = await submitAiCupLabel({
      slotKey: "VAR::MOD:0",
      prompt: "cats reading on a moon",
      cartSessionId: "session-uuid-here",
    });
    expect(result.aiDoodleId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(result.reused).toBe(false);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      slotKey: "VAR::MOD:0",
      prompt: "cats reading on a moon",
      cartSessionId: "session-uuid-here",
    });
  });

  it("includes sourceImageBase64 when provided", async () => {
    mockFetchOnce({ ok: true, aiDoodleId: "id", status: "pending", reused: false });
    await submitAiCupLabel({
      slotKey: "VAR:::0",
      prompt: "p",
      cartSessionId: "s",
      sourceImageBase64: "data:image/png;base64,AAA",
    });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.sourceImageBase64).toBe("data:image/png;base64,AAA");
  });

  it("rejects empty prompt without POSTing", async () => {
    await expect(
      submitAiCupLabel({ slotKey: "VAR:::0", prompt: "   ", cartSessionId: "s" }),
    ).rejects.toThrow(/empty/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects prompt over 200 chars without POSTing", async () => {
    await expect(
      submitAiCupLabel({ slotKey: "VAR:::0", prompt: "x".repeat(201), cartSessionId: "s" }),
    ).rejects.toThrow(/too long/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws CupLabelClientError on server error", async () => {
    mockFetchOnce({ ok: false, error: "Quota exhausted" }, 429);
    await expect(
      submitAiCupLabel({ slotKey: "VAR:::0", prompt: "p", cartSessionId: "s" }),
    ).rejects.toBeInstanceOf(CupLabelClientError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Github/mandys_bubble_tea
npx vitest run src/lib/cup-label/client.test.ts --reporter=default
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write `src/lib/cup-label/client.ts`**

```ts
// src/lib/cup-label/client.ts
//
// Browser-side helpers for the cup-label Photo + AI sources. Wraps the
// existing /api/cup-label/upload-image and /api/cup-label/ai-submit
// routes so the LabelPicker doesn't speak fetch directly. Mirrors the
// shape of the RN app's `lib/doodle/{uploadImage.ts,aiGenerate.ts}`.

export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const AI_PROMPT_MAX_LEN = 200;

export class CupLabelClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "CupLabelClientError";
  }
}

export function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new CupLabelClientError("Failed to read file"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new CupLabelClientError("FileReader returned non-string"));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

export interface UploadPhotoResult {
  uploadedDoodleId: string;
  previewUrl: string;
}

export async function uploadPhotoForCupLabel(file: File): Promise<UploadPhotoResult> {
  if (file.size > PHOTO_MAX_BYTES) {
    throw new CupLabelClientError(
      `Image too large (max ${PHOTO_MAX_BYTES / 1024 / 1024} MB)`,
    );
  }
  const dataUri = await readFileAsDataUri(file);
  const res = await fetch("/api/cup-label/upload-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64: dataUri }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    uploadedDoodleId?: string;
    previewUrl?: string;
    error?: string;
  };
  if (!res.ok || !body.ok || !body.uploadedDoodleId || !body.previewUrl) {
    throw new CupLabelClientError(body.error ?? `Upload failed (${res.status})`, res.status);
  }
  return {
    uploadedDoodleId: body.uploadedDoodleId,
    previewUrl: body.previewUrl,
  };
}

export interface AiSubmitArgs {
  slotKey: string;
  prompt: string;
  sourceImageBase64?: string;
  cartSessionId: string;
}

export interface AiSubmitResult {
  aiDoodleId: string;
  status: "pending" | "ready" | "failed";
  reused: boolean;
}

export async function submitAiCupLabel(args: AiSubmitArgs): Promise<AiSubmitResult> {
  const prompt = args.prompt.trim();
  if (prompt.length === 0) {
    throw new CupLabelClientError("Prompt is empty");
  }
  if (prompt.length > AI_PROMPT_MAX_LEN) {
    throw new CupLabelClientError(`Prompt too long (max ${AI_PROMPT_MAX_LEN} chars)`);
  }
  const body: Record<string, unknown> = {
    slotKey: args.slotKey,
    prompt,
    cartSessionId: args.cartSessionId,
  };
  if (args.sourceImageBase64) body.sourceImageBase64 = args.sourceImageBase64;
  const res = await fetch("/api/cup-label/ai-submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    aiDoodleId?: string;
    status?: AiSubmitResult["status"];
    reused?: boolean;
    error?: string;
  };
  if (!res.ok || !json.ok || !json.aiDoodleId) {
    throw new CupLabelClientError(json.error ?? `AI submit failed (${res.status})`, res.status);
  }
  return {
    aiDoodleId: json.aiDoodleId,
    status: json.status ?? "pending",
    reused: json.reused ?? false,
  };
}
```

- [ ] **Step 4: Run the new test — it should pass**

```bash
npx vitest run src/lib/cup-label/client.test.ts --reporter=default
```
Expected: 9 passed.

- [ ] **Step 5: Run tsc**

```bash
npx tsc --noEmit 2>&1 | grep -v 'scripts/dump-bitmap-png\|vitest.contract.config' | head -10
```
Expected: same set of errors as before (Picker/Section call sites still on legacy `string`). The new file should not add errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cup-label/client.ts src/lib/cup-label/client.test.ts
git commit -m "feat(cup-label/client): browser helpers for Photo upload + AI submit

- uploadPhotoForCupLabel(file): 8 MB cap, base64-encode, POST upload-image
- submitAiCupLabel({slotKey, prompt, sourceImageBase64?, cartSessionId})
- readFileAsDataUri(file): FileReader→data: URI helper
- CupLabelClientError carries server status code

Mirrors RN app lib/doodle/{uploadImage,aiGenerate}.ts."
```

---

## Task 3: Pure summary helper + payment-selections splitter

Stand up the two pure functions the components will lean on, before touching React. Keeps the React PR focused.

**Files:**
- Create: `src/components/checkout/cup-label-summary.ts`
- Create: `src/components/checkout/__tests__/cup-label-summary.test.ts`
- Create: `src/lib/cup-label/build-payment-selections.ts`
- Create: `src/lib/cup-label/build-payment-selections.test.ts`

- [ ] **Step 1: Write the summary test**

Create `src/components/checkout/__tests__/cup-label-summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { summaryFor } from "../cup-label-summary";

describe("summaryFor", () => {
  it("renders 'Pick a design' when undefined", () => {
    expect(summaryFor(undefined)).toBe("Pick a design");
  });
  it("renders preset hash prefix", () => {
    expect(summaryFor({ kind: "preset", hash: "abcdef0123" })).toBe("🎨 abcdef01…");
  });
  it("renders photo label", () => {
    expect(
      summaryFor({ kind: "photo", uploadedDoodleId: "id", previewUrl: "u" }),
    ).toBe("📷 Your photo");
  });
  it("truncates AI prompts over 32 chars", () => {
    const prompt = "two cats reading on a moon under stars";
    const out = summaryFor({ kind: "ai", aiDoodleId: "id", prompt });
    expect(out).toBe("✨ AI · two cats reading on a moon u…");
  });
  it("does not truncate AI prompts at 32 chars exactly", () => {
    const prompt = "x".repeat(32);
    expect(summaryFor({ kind: "ai", aiDoodleId: "id", prompt })).toBe(
      `✨ AI · ${prompt}`,
    );
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
npx vitest run src/components/checkout/__tests__/cup-label-summary.test.ts --reporter=default
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write `src/components/checkout/cup-label-summary.ts`**

```ts
import type { CupLabelSelection } from "@/store/cart";

const PROMPT_PREVIEW_MAX = 32;

export function summaryFor(selection: CupLabelSelection | undefined): string {
  if (!selection) return "Pick a design";
  if (selection.kind === "preset") return `🎨 ${selection.hash.slice(0, 8)}…`;
  if (selection.kind === "photo") return "📷 Your photo";
  // ai
  const prompt = selection.prompt;
  const truncated = prompt.length > PROMPT_PREVIEW_MAX;
  const head = truncated ? prompt.slice(0, PROMPT_PREVIEW_MAX) : prompt;
  return `✨ AI · ${head}${truncated ? "…" : ""}`;
}
```

- [ ] **Step 4: Run summary test — should pass**

```bash
npx vitest run src/components/checkout/__tests__/cup-label-summary.test.ts --reporter=default
```
Expected: 5 passed.

- [ ] **Step 5: Write the payment-selections splitter test**

Create `src/lib/cup-label/build-payment-selections.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPaymentSelections } from "./build-payment-selections";
import type { CupLabelSelection } from "@/store/cart";

describe("buildPaymentSelections", () => {
  it("returns empty maps when no selections", () => {
    expect(buildPaymentSelections({})).toEqual({
      presetStickerHashes: undefined,
      aiDoodleIds: undefined,
    });
  });

  it("routes preset → presetStickerHashes", () => {
    const sel: Record<string, CupLabelSelection> = {
      "A:0": { kind: "preset", hash: "hash1" },
      "A:1": { kind: "preset", hash: "hash2" },
    };
    expect(buildPaymentSelections(sel)).toEqual({
      presetStickerHashes: { "A:0": "hash1", "A:1": "hash2" },
      aiDoodleIds: undefined,
    });
  });

  it("routes photo + ai → aiDoodleIds (same map, server-side identical)", () => {
    const sel: Record<string, CupLabelSelection> = {
      "A:0": { kind: "photo", uploadedDoodleId: "photo-id", previewUrl: "u" },
      "A:1": { kind: "ai", aiDoodleId: "ai-id", prompt: "p" },
    };
    expect(buildPaymentSelections(sel)).toEqual({
      presetStickerHashes: undefined,
      aiDoodleIds: { "A:0": "photo-id", "A:1": "ai-id" },
    });
  });

  it("splits a mixed cart into two parallel maps", () => {
    const sel: Record<string, CupLabelSelection> = {
      "A:0": { kind: "preset", hash: "h" },
      "A:1": { kind: "photo", uploadedDoodleId: "p-id", previewUrl: "u" },
      "A:2": { kind: "ai", aiDoodleId: "a-id", prompt: "p" },
    };
    expect(buildPaymentSelections(sel)).toEqual({
      presetStickerHashes: { "A:0": "h" },
      aiDoodleIds: { "A:1": "p-id", "A:2": "a-id" },
    });
  });
});
```

- [ ] **Step 6: Verify it fails**

```bash
npx vitest run src/lib/cup-label/build-payment-selections.test.ts --reporter=default
```
Expected: FAIL — module does not exist.

- [ ] **Step 7: Write `src/lib/cup-label/build-payment-selections.ts`**

```ts
import type { CupLabelSelection } from "@/store/cart";

export interface PaymentSelectionsPayload {
  presetStickerHashes: Record<string, string> | undefined;
  aiDoodleIds: Record<string, string> | undefined;
}

/** Split the cart's discriminated union into the two parallel maps
 *  /api/payment accepts. Photo and AI both land in `aiDoodleIds` —
 *  the server's enqueueCupLabelJobs treats them identically.
 *  Empty results become `undefined` so the JSON payload doesn't
 *  carry `{}` (route validator skips when undefined). */
export function buildPaymentSelections(
  selections: Record<string, CupLabelSelection>,
): PaymentSelectionsPayload {
  const presetStickerHashes: Record<string, string> = {};
  const aiDoodleIds: Record<string, string> = {};
  for (const [slotKey, sel] of Object.entries(selections)) {
    if (sel.kind === "preset") presetStickerHashes[slotKey] = sel.hash;
    else if (sel.kind === "photo") aiDoodleIds[slotKey] = sel.uploadedDoodleId;
    else aiDoodleIds[slotKey] = sel.aiDoodleId;
  }
  return {
    presetStickerHashes: Object.keys(presetStickerHashes).length ? presetStickerHashes : undefined,
    aiDoodleIds: Object.keys(aiDoodleIds).length ? aiDoodleIds : undefined,
  };
}
```

- [ ] **Step 8: Run splitter test — should pass**

```bash
npx vitest run src/lib/cup-label/build-payment-selections.test.ts --reporter=default
```
Expected: 4 passed.

- [ ] **Step 9: Run tsc — same baseline errors only**

```bash
npx tsc --noEmit 2>&1 | grep -v 'scripts/dump-bitmap-png\|vitest.contract.config' | head -10
```
Expected: unchanged set (Picker/Section call sites still on legacy string).

- [ ] **Step 10: Commit**

```bash
git add \
  src/components/checkout/cup-label-summary.ts \
  src/components/checkout/__tests__/cup-label-summary.test.ts \
  src/lib/cup-label/build-payment-selections.ts \
  src/lib/cup-label/build-payment-selections.test.ts
git commit -m "feat(cup-label): pure helpers — summaryFor + buildPaymentSelections

- summaryFor: per-cup row label by selection.kind, prompt truncated at 32
- buildPaymentSelections: union → { presetStickerHashes, aiDoodleIds }
  (photo + ai collapse into the same map, server treats them identically)"
```

---

## Task 4: LabelPicker — accept union + add 3-tab bar + retain Gallery body

This task refactors the Picker shell without adding Photo/AI bodies yet. Gallery tab keeps its current grid; Photo/AI tabs render a temporary placeholder ("Coming up next") so the tab bar already works before later tasks fill them.

**Files:**
- Modify: `src/components/checkout/LabelPicker.tsx`

- [ ] **Step 1: Rewrite `LabelPicker.tsx`**

Replace the file contents:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
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
  /** slotKey of the cup we're picking for — needed by AI submit. */
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

// Defer to Task 5/6 for real Photo + AI bodies.
void useMemo;
```

The `void useMemo` at the bottom suppresses a "unused import" lint until Task 5/6 actually reaches for `useMemo`. Remove it then.

- [ ] **Step 2: Patch `CupLabelSection.tsx` to satisfy the new Picker prop shape**

The Picker now requires `slotKey`, `cartSessionId`, `isSignedIn` and a union `current`. Minimum-change wrap so this task compiles; Task 6 will rework the section more.

Edit `src/components/checkout/CupLabelSection.tsx`. Add at top imports (verified path: `useAuth` is exported from `@/components/auth/AuthProvider`):

```tsx
import { useAuth } from "@/components/auth/AuthProvider";
import type { CupLabelSelection } from "@/store/cart";
```

Inside `CupLabelSection`, add:

```tsx
  const cartSessionId = useCart((s) => s.cartSessionId);
  const { profile } = useAuth();
  const isSignedIn = profile != null;
```

Inside the auto-random effect, replace:

```tsx
        if (!labelSelections[key]) {
          setLabel(key, pickRandomHash(manifest.hashes));
        }
```

with:

```tsx
        if (!labelSelections[key]) {
          setLabel(key, { kind: "preset", hash: pickRandomHash(manifest.hashes) });
        }
```

In the per-cup row render, the existing `const hash = labelSelections[key]` was typed as `string | undefined`. Change to:

```tsx
            const sel: CupLabelSelection | undefined = labelSelections[key];
            const hash = sel?.kind === "preset" ? sel.hash : undefined;
```

And in the `<LabelPicker>` props at the bottom:

```tsx
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
```

- [ ] **Step 3: Run tsc — expect only the existing baseline errors**

```bash
npx tsc --noEmit 2>&1 | grep -v 'scripts/dump-bitmap-png\|vitest.contract.config' | head -10
```
Expected: empty (no app errors).

- [ ] **Step 4: Run vitest for everything cup-label and cart**

```bash
npx vitest run src/lib/cup-label/ src/components/checkout/ src/store/ --reporter=default
```
Expected: all green (Picker has no tests, but it shouldn't break the unit-tested modules either).

- [ ] **Step 5: Manual smoke — dev server hot-reload, click Change, see Tabs**

The dev server is already running at `http://localhost:3000` (per task #4 in earlier session). Reload the `/checkout` page in the cmux browser pane and click `Change` on any cup. Verify:
- Modal opens with three tabs at the top (`🎨 Gallery / 📷 Photo / ✨ AI`)
- Gallery tab is the default and still shows the 78-thumb grid (auto-random pick highlighted)
- Switching to Photo / AI tabs shows the placeholder text (or sign-in gate if logged out)

If the Gallery grid breaks (manifest fetch error, etc.), check the dev server console.

- [ ] **Step 6: Commit**

```bash
git add src/components/checkout/LabelPicker.tsx src/components/checkout/CupLabelSection.tsx
git commit -m "refactor(cup-label/picker): 3-tab shell + union API + auth-gated placeholders

- LabelPicker now consumes/emits CupLabelSelection union (not gallery hash)
- New tab bar: 🎨 Gallery / 📷 Photo / ✨ AI; default tab derives from
  current selection kind
- Gallery body unchanged (extracted into GalleryTab sub-component)
- Photo + AI tabs render placeholder + sign-in gate (real bodies in
  Task 5 and Task 6)
- CupLabelSection feeds new Picker props (slotKey + cartSessionId +
  isSignedIn) and stores auto-random as { kind:'preset', hash }"
```

---

## Task 5: Photo tab body — file input → upload → preview → commit

**Files:**
- Modify: `src/components/checkout/LabelPicker.tsx`

- [ ] **Step 1: Replace the `PhotoTabPlaceholder` with the real body**

In `src/components/checkout/LabelPicker.tsx`, replace the `PhotoTabPlaceholder` component with `PhotoTab` and pass the needed props. Also import the client helpers.

Add imports at the top:

```tsx
import { uploadPhotoForCupLabel, CupLabelClientError } from "@/lib/cup-label/client";
```

Replace the body switch inside `LabelPicker` for the Photo tab:

```tsx
          ) : tab === "photo" ? (
            <PhotoTab
              isSignedIn={isSignedIn}
              current={current?.kind === "photo" ? current : undefined}
              onSelect={(sel) => {
                onSelect(sel);
                onOpenChange(false);
              }}
            />
          ) : (
```

Add the `PhotoTab` component (replace the placeholder):

```tsx
function PhotoTab({
  isSignedIn,
  current,
  onSelect,
}: {
  isSignedIn: boolean;
  current: Extract<CupLabelSelection, { kind: "photo" }> | undefined;
  onSelect: (sel: Extract<CupLabelSelection, { kind: "photo" }>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<Extract<
    CupLabelSelection,
    { kind: "photo" }
  > | null>(current ?? null);

  if (!isSignedIn) return <SignInGate label="Photo" />;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
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
```

Remove `PhotoTabPlaceholder` and the now-unused `void useMemo` line.

- [ ] **Step 2: Run tsc**

```bash
npx tsc --noEmit 2>&1 | grep -v 'scripts/dump-bitmap-png\|vitest.contract.config' | head -10
```
Expected: empty.

- [ ] **Step 3: Run vitest**

```bash
npx vitest run src/lib/cup-label/ src/components/checkout/ src/store/ --reporter=default
```
Expected: all green (no UI tests added).

- [ ] **Step 4: Manual smoke**

Reload `/checkout`, sign in (or use a logged-in test account), click `Change`, switch to `📷 Photo`, click `Choose a photo`, pick an image. After upload completes:
- Binarised preview appears in the 64×64 viewport (sharp 1-bit Atkinson)
- "Use this photo" button commits — modal closes, cup row's thumbnail switches to the photo preview, summary reads "📷 Your photo"

If the preview URL 404s, the server isn't returning a public/signed URL — check the `aiDoodlePreviewUrl` helper on the server.

- [ ] **Step 5: Commit**

```bash
git add src/components/checkout/LabelPicker.tsx
git commit -m "feat(cup-label/picker): Photo tab — pick → upload → preview → commit

- file input with capture=environment for mobile camera shortcut
- uses uploadPhotoForCupLabel client helper (8 MB cap, base64, POST)
- staged preview thumbnail (binarised PNG from server)
- 'Use this photo' commits CupLabelSelection {kind:'photo',...}
- auth-gated; error surfaces inline"
```

---

## Task 6: AI tab body — prompt + optional reference image → submit (no preview)

**Files:**
- Modify: `src/components/checkout/LabelPicker.tsx`

- [ ] **Step 1: Replace `AiTabPlaceholder` with the real body**

Update the imports (add `submitAiCupLabel`, `AI_PROMPT_MAX_LEN`, `readFileAsDataUri`):

```tsx
import {
  uploadPhotoForCupLabel,
  submitAiCupLabel,
  readFileAsDataUri,
  AI_PROMPT_MAX_LEN,
  CupLabelClientError,
} from "@/lib/cup-label/client";
```

Replace the body switch inside `LabelPicker`:

```tsx
          ) : (
            <AiTab
              isSignedIn={isSignedIn}
              slotKey={_slotKey}
              cartSessionId={_cartSessionId}
              current={current?.kind === "ai" ? current : undefined}
              onSelect={(sel) => {
                onSelect(sel);
                onOpenChange(false);
              }}
            />
          )}
```

(Also remove the underscores in the prop destructure since the Picker now uses them — rename `_slotKey` → `slotKey` and `_cartSessionId` → `cartSessionId`.)

Add the `AiTab` component (replace the placeholder):

```tsx
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Extract<
    CupLabelSelection,
    { kind: "ai" }
  > | null>(current ?? null);

  if (!isSignedIn) return <SignInGate label="AI" />;

  const trimmed = prompt.trim();
  const overLimit = trimmed.length > AI_PROMPT_MAX_LEN;
  const canSubmit = !busy && trimmed.length > 0 && !overLimit;

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

  async function handleGenerate() {
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      const { aiDoodleId } = await submitAiCupLabel({
        slotKey,
        prompt: trimmed,
        sourceImageBase64: refDataUri ?? undefined,
        cartSessionId,
      });
      const sel = { kind: "ai" as const, aiDoodleId, prompt: trimmed };
      setSubmitted(sel);
      onSelect(sel);
    } catch (err) {
      const msg =
        err instanceof CupLabelClientError
          ? err.message
          : "AI submit failed — please try again.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-3 p-4 text-center">
        <p className="text-3xl">✨</p>
        <p className="text-sm font-medium">Submitted!</p>
        <p className="max-w-md text-sm text-zinc-600">
          Your AI image will be a surprise on your cup — we won&apos;t show you a
          preview here. Prompt: <em>{submitted.prompt}</em>
        </p>
        <button
          type="button"
          onClick={() => {
            setSubmitted(null);
            setPrompt(submitted.prompt);
          }}
          className="text-sm text-zinc-500 underline"
        >
          Change prompt
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-2">
      <label className="text-sm font-medium">
        Describe your design
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={AI_PROMPT_MAX_LEN + 50 /* allow user to see overflow */}
          rows={3}
          placeholder="e.g. two cats reading on a moon, line drawing"
          className="mt-1 w-full rounded-md border border-zinc-300 p-2 text-sm"
          disabled={busy}
        />
      </label>
      <p
        className="text-xs"
        style={{ color: overLimit ? "#dc2626" : "#71717a" }}
      >
        {trimmed.length}/{AI_PROMPT_MAX_LEN}
      </p>

      <label className="flex cursor-pointer items-center gap-2 self-start rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium">
        <input
          type="file"
          accept="image/*"
          onChange={handleRefFile}
          disabled={busy}
          className="hidden"
        />
        {refDataUri ? "Reference image attached" : "Add a reference image (optional)"}
      </label>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="button"
        onClick={handleGenerate}
        disabled={!canSubmit}
        className="self-end rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: BRAND.primaryColor }}
      >
        {busy ? "Submitting…" : "Generate"}
      </button>
    </div>
  );
}
```

Remove `AiTabPlaceholder`.

- [ ] **Step 2: Run tsc**

```bash
npx tsc --noEmit 2>&1 | grep -v 'scripts/dump-bitmap-png\|vitest.contract.config' | head -10
```
Expected: empty.

- [ ] **Step 3: Run vitest**

```bash
npx vitest run src/lib/cup-label/ src/components/checkout/ src/store/ --reporter=default
```
Expected: all green.

- [ ] **Step 4: Manual smoke**

Reload `/checkout`, sign in, click `Change`, switch to `✨ AI`. Type a short prompt (e.g. "cute boba"), optionally attach a reference image, click `Generate`. After submit:
- "Submitted!" surprise screen renders with the prompt echoed
- Modal closes when clicking the Picker outside region — cup row's summary should read `✨ AI · cute boba`
- Re-opening the Picker on the same cup defaults to the AI tab and shows the prior submitted state

If the textarea char counter never turns red, type >200 chars to verify.

- [ ] **Step 5: Commit**

```bash
git add src/components/checkout/LabelPicker.tsx
git commit -m "feat(cup-label/picker): AI tab — prompt + optional reference → surprise UX

- prompt textarea, 200-char counter (turns red over limit)
- optional reference image (8 MB cap, inline base64, not uploaded)
- POST /api/cup-label/ai-submit with slotKey + cartSessionId
- 'Submitted!' confirmation, no preview (matches RN 'surprise on your
  cup' UX); 'Change prompt' re-opens the form
- auth-gated, error surfaces inline"
```

---

## Task 7: CupLabelSection — render by kind + preserve non-preset selections

**Files:**
- Modify: `src/components/checkout/CupLabelSection.tsx`

- [ ] **Step 1: Update CupLabelSection thumbnail + summary**

Open `src/components/checkout/CupLabelSection.tsx` and apply these changes.

Add imports at top (replace the existing `useCart, cupKey, type CartLine` import):

```tsx
import { useCart, cupKey, type CartLine, type CupLabelSelection } from "@/store/cart";
import { summaryFor } from "./cup-label-summary";
```

Inside the per-cup `<li>` render, replace the thumbnail block:

```tsx
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-zinc-50 sm:h-16 sm:w-16">
                {renderThumb(sel)}
              </div>
```

Replace the existing `<p className="truncate text-xs text-zinc-500">` cup-summary line with two lines — the variation row and a new label-summary row:

```tsx
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
```

Add the `renderThumb` helper outside the component:

```tsx
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
  // kind: "ai" — no preview; placeholder star
  return (
    <div className="flex h-full w-full items-center justify-center bg-zinc-50 text-xl">
      ✨
    </div>
  );
}
```

(The `sel` variable is already declared inside the cup-render loop from Task 4 — keep it.)

The auto-random effect already only fills when `!labelSelections[key]`, so AI / photo selections survive re-renders. No change needed there.

- [ ] **Step 2: Run tsc**

```bash
npx tsc --noEmit 2>&1 | grep -v 'scripts/dump-bitmap-png\|vitest.contract.config' | head -10
```
Expected: empty.

- [ ] **Step 3: Run vitest cup-label + store + checkout suites**

```bash
npx vitest run src/lib/cup-label/ src/components/checkout/ src/store/ --reporter=default
```
Expected: all green; `cup-label-summary.test.ts` covers the four summary branches.

- [ ] **Step 4: Manual smoke — three-cup mixed cart**

Set up a 3-cup line on `/checkout`. For each cup, open the picker and pick a different kind: cup 0 stays auto-random Gallery, cup 1 → Photo, cup 2 → AI. Verify each row shows:
- Cup 0: gallery hash thumbnail + summary `🎨 abc12345…`
- Cup 1: photo preview thumbnail + summary `📷 Your photo`
- Cup 2: ✨ placeholder + summary `✨ AI · <prompt>`

- [ ] **Step 5: Commit**

```bash
git add src/components/checkout/CupLabelSection.tsx
git commit -m "feat(cup-label/section): render thumbnail + summary by selection.kind

- renderThumb dispatches: gallery PNG / photo previewUrl / ✨ AI placeholder
- summary line uses summaryFor pure helper
- auto-random only fills when slot is empty; photo/ai survive re-render"
```

---

## Task 8: Checkout submit — split union into payment body maps

**Files:**
- Modify: `src/app/checkout/page.tsx`

- [ ] **Step 1: Wire `buildPaymentSelections` into the payment POST**

Open `src/app/checkout/page.tsx`. Add import near the top:

```tsx
import { buildPaymentSelections } from "@/lib/cup-label/build-payment-selections";
```

Replace the `presetStickerHashes` build block (added in the earlier wire-fix commit) — it currently looks roughly like:

```tsx
      const presetStickerHashes =
        Object.keys(labelSelections).length > 0 ? labelSelections : undefined;
      const paymentRes = await fetch("/api/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: sourceToken,
          orderId: orderJson.orderId,
          verificationToken,
          presetStickerHashes,
        }),
      });
```

Replace with:

```tsx
      const { presetStickerHashes, aiDoodleIds } = buildPaymentSelections(labelSelections);
      const paymentRes = await fetch("/api/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: sourceToken,
          orderId: orderJson.orderId,
          verificationToken,
          presetStickerHashes,
          aiDoodleIds,
        }),
      });
```

- [ ] **Step 2: Run tsc**

```bash
npx tsc --noEmit 2>&1 | grep -v 'scripts/dump-bitmap-png\|vitest.contract.config' | head -10
```
Expected: empty.

- [ ] **Step 3: Run targeted vitest**

```bash
npx vitest run src/lib/cup-label/build-payment-selections.test.ts src/lib/cup-label/ src/store/ src/components/checkout/ --reporter=default
```
Expected: all green; splitter test already passes from Task 3.

- [ ] **Step 4: Manual end-to-end smoke**

Single-tab orders (one at a time, with the cup-label monitor open at the Mac mini log):

1. **Gallery only** — pick a sticker on cup 0, `Pay` (sandbox card), confirm:
   - cup_label_jobs row has `doodle_source = preset_sticker`, `doodle_pool_key = <hash>`
   - Mac mini log emits `[cup-label dev] slot ... → sticker:<hash prefix>` then `printed OLxxx`
   - ZD410 prints the chosen sticker (physically verify)
2. **Photo only** — repeat with `📷 Photo` tab, upload a selfie:
   - cup_label_jobs row has `doodle_source = ai`, `original_image_path` points at the upload Storage object
   - Mac mini prints the binarised photo
3. **AI only** — repeat with `✨ AI`, prompt "cute boba":
   - cup_label_jobs row has `doodle_source = ai`, `ai_job_id` set, `original_image_path` set on Doubao success (or null if failed → check failure handling)
   - Mac mini prints Doubao output (or hash-default fallback if Doubao failed)

Then a **mixed cart** — 3-cup line, cup 0 Gallery / cup 1 Photo / cup 2 AI. Verify three `cup_label_jobs` rows with the expected `doodle_source` per row and ZD410 prints three distinct labels.

Use the existing monitor stream (`bay6natj2`) to catch printed events.

- [ ] **Step 5: Commit**

```bash
git add src/app/checkout/page.tsx
git commit -m "feat(checkout): split labelSelections union into payment body maps

- presetStickerHashes (from preset selections)
- aiDoodleIds (from photo + ai selections, server-side identical)
- uses buildPaymentSelections pure helper"
```

---

## Task 9: Final verification gate

- [ ] **Step 1: Full project tsc**

```bash
cd ~/Github/mandys_bubble_tea
npx tsc --noEmit 2>&1 | grep -v 'scripts/dump-bitmap-png\|vitest.contract.config' | head -20
```
Expected: empty (3 pre-existing baseline errors filtered out).

- [ ] **Step 2: Full cup-label + cart vitest sweep**

```bash
npx vitest run src/lib/cup-label/ src/components/checkout/ src/store/ --reporter=default
```
Expected: > 40 tests passing (cart-label-selections 6 + client 9 + cup-label-summary 5 + build-payment-selections 4 + existing fortune 10 + existing enqueue 11 + existing render-zebra-cup 9 = ~54).

- [ ] **Step 3: Verify ZD411 receipt path unaffected**

```bash
ssh mingxuanzhang@100.123.132.52 'tail -20 ~/Library/Logs/mandy-printer-client.out.log 2>&1; echo "---ERR---"; tail -10 ~/Library/Logs/mandy-printer-client.err.log 2>&1'
```
Expected: realtime subscribed, recent `printed OLxxx (n cups)` lines for any real prod orders since the test started; no new `fetch failed` errors after the Tailscale recovery.

- [ ] **Step 4: Verify cup-label launchagent independent**

```bash
ssh mingxuanzhang@100.123.132.52 'launchctl list | grep -E "printer-client|cup-label"'
```
Expected: two lines, both pid != 0, no exit codes.

- [ ] **Step 5: Done — push the branch when Stan greenlights**

`feat/cup-label-zebra-zd410` now carries: prior wire fix, Photo/AI port, all tests green. Stan decides when to `git push origin feat/cup-label-zebra-zd410` and start the PR review / merge path (per the Pending Stan #1 in the DEV_HANDOFF).

---

## Out-of-scope (explicit non-actions)

- No Draw tab — YAGNI per design.
- No `cup_label_jobs` schema migration (only CHECK constraint extension was needed; already applied earlier in the session).
- No printer-client changes — the existing ZD410 USB direct-write codepath already handles `aiDoodleIds`-sourced ZPL rows identically to gallery-sourced ones.
- No new server routes — `upload-image` and `ai-submit` already shipped for the RN app.
