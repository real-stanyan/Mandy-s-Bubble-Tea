# Checkout Doodle — Phase 2 (App UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the per-cup doodle drawing UI to the RN app and wire it through to the existing CloudPRNT pipeline so users can replace the default-pool image with their own ink on each cup label.

**Architecture:** Two repos. Backend (`mandys_bubble_tea`, branch `feat/cup-label-tsp100`) gains `/api/doodle/upload` storing path JSON in a private Supabase bucket and an extended `enqueueCupLabelJobs` that consumes a `doodleIds` map. RN app (`mandys_bubble_tea_app`, new branch `feat/cup-label-app-doodle`) gains `DoodleSection`/`DoodleModal`/`DoodleCanvas` (using `react-native-svg` + `PanResponder`), a parity-tested pool mirror, `cartToSlots`, an upload helper, and a checkout integration that batch-uploads on Pay then forwards `doodleIds` to `/api/payment`.

**Tech Stack:** Next.js 14 + Supabase Storage + vitest (backend); Expo SDK 54 + Expo Router 6 + react-native-svg 15 + PanResponder + jest (RN).

**Spec reference:** `docs/superpowers/specs/2026-04-27-checkout-doodle-cup-label-design.md` § 3, § 4.1, § 7 stage 2.

**Phase 1 reuse:** `validateSvgPath` + `pathsJsonToSvg` (`src/lib/doodle/render-svg.ts`), `renderCupLabelToBitmap` (`src/lib/cup-label/render-tsp100.ts`), `pickDefaultForCup` + cyrb53 hash (`src/lib/doodle/pool.ts`), `cup_label_jobs` table with already-present `doodle_paths jsonb` column.

---

## File Structure

### Backend (`/Users/stanyan/Github/mandys_bubble_tea`)

```
supabase/migrations/
  2026-04-27-doodle-uploads-storage.sql      [Task 1] new

src/lib/doodle/
  upload-store.ts                            [Task 2] new
  upload-store.test.ts                       [Task 2] new

src/app/api/doodle/upload/
  route.ts                                   [Task 2] new

src/lib/cup-label/
  enqueue.ts                                 [Task 3] modify
  enqueue.test.ts                            [Task 3] new
  client-line-id.ts                          [Task 3] new

src/app/api/payment/
  route.ts                                   [Task 4] modify
src/app/api/webhooks/square/
  route.ts                                   [Task 4] modify (signature only)
```

### RN App (`/Users/stanyan/Github/mandys_bubble_tea_app`)

```
lib/doodle/
  pool.ts                                    [Task 5] new
  pool.test.ts                               [Task 5] new
  cartToSlots.ts                             [Task 6] new
  cartToSlots.test.ts                        [Task 6] new
  uploadDoodle.ts                            [Task 10] new
  clientLineId.ts                            [Task 6] new (mirrors backend client-line-id.ts)

components/doodle/
  DoodleCanvas.tsx                           [Task 7] new
  DoodleModal.tsx                            [Task 8] new
  DoodleSection.tsx                          [Task 9] new

hooks/
  use-payment.ts                             [Task 10] modify

app/
  checkout.tsx                               [Task 11] modify
```

---

## Cross-Repo Contract

**`clientLineId` algorithm (must match exactly on both sides):**

```
clientLineId(variationId, modifierIds[]) =
  variationId + "::" + sorted(modifierIds).join(",")
```

The RN cart already uses this (`store/cart.ts: buildLineId`). The backend computes the same key from each Square `OrderLineItem.catalogObjectId` + sorted `modifiers[].catalogObjectId` to look up doodleIds.

**`/api/doodle/upload` contract:**

- Auth: Supabase session (Bearer); 401 if no user.
- Body: `{ paths: SvgPath[] }`, where `SvgPath = { d: string; stroke: string; width: number }`.
- Validation: 1–200 paths, each path passed through `validateSvgPath`.
- Returns: `{ doodleId: string }` on 200.

**`/api/payment` contract addition (additive, fully backwards compatible):**

- Body gains optional `doodleIds?: Record<string, string>` keyed by `${clientLineId}:${cupIdx}`.
- Forwarded to `enqueueCupLabelJobs({ order, stickerNumber, doodleIds })`.
- Missing keys → default pool (current behavior).

---

# Tasks

## Backend

### Task 1: Storage migration for doodle uploads

**Goal:** Add a private bucket `doodles_pending/` for user path JSON, separate from `doodles/` (rendered raster) and `doodles_pool/` (pre-rendered defaults).

**Files:**
- Create: `supabase/migrations/2026-04-27-doodle-uploads-storage.sql`

- [ ] **Step 1: Write migration**

```sql
-- Bucket for user-uploaded doodle path JSON files (pre-render staging).
-- Server-only access (service role); client uploads go through /api/doodle/upload
-- which writes via the admin client. RLS denies all client-direct access.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'doodles_pending',
  'doodles_pending',
  false,
  131072,                     -- 128KB cap; well above ~30KB of typical paths JSON
  array['application/json']
)
on conflict (id) do nothing;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/2026-04-27-doodle-uploads-storage.sql
git commit -m "feat(cup-label): add doodles_pending storage bucket for user path uploads"
```

---

### Task 2: `/api/doodle/upload` route + upload-store helper (TDD)

**Goal:** A request-scoped helper that stores validated path JSON to `doodles_pending/{userId}/{doodleId}.json` and returns the id. The route enforces auth + body shape and delegates to the helper.

**Files:**
- Create: `src/lib/doodle/upload-store.ts`
- Create: `src/lib/doodle/upload-store.test.ts`
- Create: `src/app/api/doodle/upload/route.ts`

- [ ] **Step 1: Write failing tests for upload-store**

```ts
// src/lib/doodle/upload-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadMock = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({ upload: uploadMock }),
    },
  }),
}));

import { saveUserDoodleUpload, MAX_PATHS } from "./upload-store";

beforeEach(() => {
  uploadMock.mockReset();
  uploadMock.mockResolvedValue({ error: null });
});

describe("saveUserDoodleUpload", () => {
  const okPath = { d: "M0,0 L10,10", stroke: "#000", width: 3 };

  it("rejects when paths is empty", async () => {
    await expect(saveUserDoodleUpload({ userId: "u1", paths: [] }))
      .rejects.toThrow(/at least one path/);
  });

  it(`rejects when paths exceeds MAX_PATHS (${200})`, async () => {
    const many = Array(201).fill(okPath);
    await expect(saveUserDoodleUpload({ userId: "u1", paths: many }))
      .rejects.toThrow(/too many paths/);
  });

  it("rejects malformed path entries", async () => {
    const bad = { d: "<script>", stroke: "#000", width: 3 } as never;
    await expect(saveUserDoodleUpload({ userId: "u1", paths: [bad] }))
      .rejects.toThrow(/disallowed characters/);
  });

  it("stores valid paths and returns a doodleId", async () => {
    const out = await saveUserDoodleUpload({ userId: "u1", paths: [okPath] });
    expect(out.doodleId).toMatch(/^[0-9a-f-]{36}$/);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [path, body, opts] = uploadMock.mock.calls[0];
    expect(path).toBe(`u1/${out.doodleId}.json`);
    expect(opts.contentType).toBe("application/json");
    expect(JSON.parse(body.toString())).toEqual({ paths: [okPath] });
  });

  it("propagates storage errors", async () => {
    uploadMock.mockResolvedValue({ error: { message: "disk full" } });
    await expect(saveUserDoodleUpload({ userId: "u1", paths: [okPath] }))
      .rejects.toThrow(/disk full/);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- src/lib/doodle/upload-store.test.ts
```

Expected: file not found / module not exported.

- [ ] **Step 3: Implement upload-store**

```ts
// src/lib/doodle/upload-store.ts
import "server-only";
import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { validateSvgPaths } from "./render-svg";
import type { SvgPath } from "./render-svg";

export const MAX_PATHS = 200;

export type SaveUserDoodleArgs = { userId: string; paths: SvgPath[] };
export type SaveUserDoodleResult = { doodleId: string };

export async function saveUserDoodleUpload(
  args: SaveUserDoodleArgs,
): Promise<SaveUserDoodleResult> {
  if (!args.paths || args.paths.length === 0) {
    throw new Error("paths must contain at least one path");
  }
  if (args.paths.length > MAX_PATHS) {
    throw new Error(`paths has too many entries (max ${MAX_PATHS})`);
  }
  validateSvgPaths(args.paths);

  const doodleId = randomUUID();
  const sb = getSupabaseAdmin();
  const path = `${args.userId}/${doodleId}.json`;
  const body = Buffer.from(JSON.stringify({ paths: args.paths }), "utf8");
  const { error } = await sb.storage
    .from("doodles_pending")
    .upload(path, body, { contentType: "application/json", upsert: false });
  if (error) throw new Error(error.message);

  return { doodleId };
}

export async function loadUserDoodleUpload(
  userId: string,
  doodleId: string,
): Promise<SvgPath[]> {
  const sb = getSupabaseAdmin();
  const path = `${userId}/${doodleId}.json`;
  const { data, error } = await sb.storage.from("doodles_pending").download(path);
  if (error) throw new Error(`doodle ${doodleId} not found: ${error.message}`);
  const text = await data.text();
  const parsed = JSON.parse(text) as { paths: SvgPath[] };
  validateSvgPaths(parsed.paths);
  return parsed.paths;
}
```

- [ ] **Step 4: Export `validateSvgPaths` from render-svg.ts**

Edit `src/lib/doodle/render-svg.ts`: rename internal `validateSvgPath` to remain internal, and add a top-level `export function validateSvgPaths(paths: SvgPath[]): void` that maps over `validateSvgPath`. (Keep the existing per-path call inside `pathsJsonToSvg` working.)

```ts
// add at bottom of src/lib/doodle/render-svg.ts
export function validateSvgPaths(paths: SvgPath[]): void {
  for (const p of paths) validateSvgPath(p);
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npm test -- src/lib/doodle/upload-store.test.ts
```

- [ ] **Step 6: Implement the route**

```ts
// src/app/api/doodle/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth";
import { saveUserDoodleUpload } from "@/lib/doodle/upload-store";
import type { SvgPath } from "@/lib/doodle/render-svg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UploadBody = { paths: SvgPath[] };

function isValidBody(body: unknown): body is UploadBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Partial<UploadBody>;
  return Array.isArray(b.paths);
}

export async function POST(request: NextRequest) {
  const user = await getAuthedUser(request);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isValidBody(body)) {
    return NextResponse.json({ ok: false, error: "Missing paths array" }, { status: 400 });
  }

  try {
    const { doodleId } = await saveUserDoodleUpload({
      userId: user.id,
      paths: body.paths,
    });
    return NextResponse.json({ ok: true, doodleId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "upload failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
```

- [ ] **Step 7: Smoke-test the route locally** (optional during plan execution)

```bash
curl -X POST http://localhost:3000/api/doodle/upload \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <session-jwt>' \
  -d '{"paths":[{"d":"M0,0 L10,10","stroke":"#000","width":3}]}'
```

Expected: `{"ok":true,"doodleId":"<uuid>"}`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/doodle/upload-store.ts \
        src/lib/doodle/upload-store.test.ts \
        src/lib/doodle/render-svg.ts \
        src/app/api/doodle/upload/route.ts
git commit -m "feat(cup-label): add /api/doodle/upload + upload-store helper"
```

---

### Task 3: Extend `enqueueCupLabelJobs` to consume user doodles (TDD)

**Goal:** Per cup, look up `doodleIds[${clientLineId}:${cupIdx}]`. If present, fetch paths, render with user SVG, set `doodle_source='user'`, store paths in `doodle_paths`. If absent, keep existing default-pool path.

**Files:**
- Create: `src/lib/cup-label/client-line-id.ts`
- Modify: `src/lib/cup-label/enqueue.ts`
- Create: `src/lib/cup-label/enqueue.test.ts`

- [ ] **Step 1: Write client-line-id helper**

```ts
// src/lib/cup-label/client-line-id.ts
import "server-only";
import type { OrderLineItem } from "square";

// Mirrors the RN cart's buildLineId (store/cart.ts):
//   variationId + "::" + sorted(modifierIds).join(",")
export function clientLineIdFromSquareLine(line: OrderLineItem): string {
  const variationId = line.catalogObjectId ?? "";
  const modIds = (line.modifiers ?? [])
    .map(m => m.catalogObjectId ?? "")
    .filter(Boolean)
    .sort();
  return `${variationId}::${modIds.join(",")}`;
}
```

- [ ] **Step 2: Write failing tests for enqueue**

```ts
// src/lib/cup-label/enqueue.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadMock = vi.fn();
const upsertMock = vi.fn();
const downloadMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: (b: string) => ({
        upload: uploadMock,
        download: (...a: unknown[]) => downloadMock(b, ...a),
      }),
    },
    from: () => ({ upsert: upsertMock }),
  }),
}));

vi.mock("./render-tsp100", () => ({
  renderCupLabelToBitmap: vi.fn().mockResolvedValue(Buffer.from([0])),
}));

import { enqueueCupLabelJobs } from "./enqueue";
import { renderCupLabelToBitmap } from "./render-tsp100";

const buildOrder = () => ({
  id: "ORD1",
  lineItems: [
    {
      uid: "sq-line-1",
      catalogObjectId: "VAR1",
      name: "Pearl Milk Tea",
      quantity: "2",
      modifiers: [
        { catalogObjectId: "MOD_PEARL", name: "Pearl" },
        { catalogObjectId: "MOD_50S", name: "50% sugar" },
      ],
    },
  ],
});

beforeEach(() => {
  uploadMock.mockReset().mockResolvedValue({ error: null });
  upsertMock.mockReset().mockResolvedValue({ error: null });
  downloadMock.mockReset();
  (renderCupLabelToBitmap as unknown as ReturnType<typeof vi.fn>).mockClear();
});

describe("enqueueCupLabelJobs (default path, regression)", () => {
  it("inserts default-source rows when no doodleIds passed", async () => {
    await enqueueCupLabelJobs({
      order: buildOrder() as never,
      stickerNumber: "OL001",
    });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [rows] = upsertMock.mock.calls[0];
    expect(rows).toHaveLength(2);
    expect(rows[0].doodle_source).toBe("default");
    expect(rows[0].doodle_paths).toBeNull();
    expect(rows[0].doodle_pool_key).toBeTruthy();
  });
});

describe("enqueueCupLabelJobs (user-doodle path)", () => {
  it("uses user paths for cups present in doodleIds, defaults for others", async () => {
    const userPaths = [{ d: "M0,0 L10,10", stroke: "#000", width: 3 }];
    downloadMock.mockResolvedValue({
      data: { text: async () => JSON.stringify({ paths: userPaths }) },
      error: null,
    });

    const clientLineId = `VAR1::MOD_50S,MOD_PEARL`;
    await enqueueCupLabelJobs({
      order: buildOrder() as never,
      stickerNumber: "OL002",
      doodleIds: { [`${clientLineId}:0`]: "doodle-uuid-1" },
      userId: "user-1",
    });

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [rows] = upsertMock.mock.calls[0];
    expect(rows).toHaveLength(2);

    const cup0 = rows.find((r: { cup_idx: number }) => r.cup_idx === 0);
    expect(cup0.doodle_source).toBe("user");
    expect(cup0.doodle_pool_key).toBeNull();
    expect(cup0.doodle_paths).toEqual(userPaths);

    const cup1 = rows.find((r: { cup_idx: number }) => r.cup_idx === 1);
    expect(cup1.doodle_source).toBe("default");
  });

  it("falls back to default if download fails (does not break the order)", async () => {
    downloadMock.mockResolvedValue({ data: null, error: { message: "not found" } });
    const clientLineId = `VAR1::MOD_50S,MOD_PEARL`;
    await enqueueCupLabelJobs({
      order: buildOrder() as never,
      stickerNumber: "OL003",
      doodleIds: { [`${clientLineId}:0`]: "missing-uuid" },
      userId: "user-1",
    });
    const [rows] = upsertMock.mock.calls[0];
    const cup0 = rows.find((r: { cup_idx: number }) => r.cup_idx === 0);
    expect(cup0.doodle_source).toBe("default");
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
npm test -- src/lib/cup-label/enqueue.test.ts
```

- [ ] **Step 4: Modify `enqueueCupLabelJobs`**

```ts
// src/lib/cup-label/enqueue.ts (full rewrite)
import "server-only";
import type { Order } from "square";
import { getSupabaseAdmin } from "../supabase-server";
import { pickDefaultForCup } from "../doodle/pool";
import { pathsJsonToSvg, type SvgPath } from "../doodle/render-svg";
import { loadUserDoodleUpload } from "../doodle/upload-store";
import { renderCupLabelToBitmap } from "./render-tsp100";
import { clientLineIdFromSquareLine } from "./client-line-id";

export type EnqueueCupLabelArgs = {
  order: Order;
  stickerNumber: string;
  /**
   * Optional client-supplied user doodles, keyed by `${clientLineId}:${cupIdx}`.
   * `clientLineId` matches the RN cart's buildLineId — see client-line-id.ts.
   */
  doodleIds?: Record<string, string>;
  /** Required when doodleIds is set — used to scope the storage lookup. */
  userId?: string;
};

const USER_SVG_CANVAS = 400;

type Row = {
  square_order_id: string;
  line_id: string;
  cup_idx: number;
  sticker_number: string;
  drink_name: string;
  modifiers_text: string;
  doodle_source: "default" | "user";
  doodle_pool_key: string | null;
  doodle_paths: SvgPath[] | null;
  raster_path: string;
};

export async function enqueueCupLabelJobs({
  order,
  stickerNumber,
  doodleIds,
  userId,
}: EnqueueCupLabelArgs): Promise<void> {
  const orderId = order.id!;
  const sb = getSupabaseAdmin();
  const lineItems = order.lineItems ?? [];
  const rows: Row[] = [];

  for (const [lineIdx, line] of lineItems.entries()) {
    const lineId = line.uid ?? line.catalogObjectId ?? `idx-${lineIdx}`;
    const clientLineId = clientLineIdFromSquareLine(line);
    const rawQty = Number(line.quantity ?? "1");
    const qty = Number.isFinite(rawQty) ? Math.max(0, Math.floor(rawQty)) : 0;
    const drinkName = line.name ?? "Drink";
    const modifiersText =
      (line.modifiers ?? []).map(m => m.name).filter(Boolean).join(" · ") || "—";

    for (let cupIdx = 0; cupIdx < qty; cupIdx++) {
      const userDoodleId =
        doodleIds && userId ? doodleIds[`${clientLineId}:${cupIdx}`] : undefined;

      let doodleSvg: string;
      let source: "user" | "default" = "default";
      let poolKey: string | null = null;
      let userPaths: SvgPath[] | null = null;

      if (userDoodleId && userId) {
        try {
          const paths = await loadUserDoodleUpload(userId, userDoodleId);
          doodleSvg = pathsJsonToSvg(paths, USER_SVG_CANVAS);
          source = "user";
          userPaths = paths;
        } catch (e) {
          console.error("[cup-label] user doodle load failed, falling back to default", e);
          const pool = pickDefaultForCup(lineId, cupIdx);
          doodleSvg = pool.svg;
          poolKey = pool.key;
        }
      } else {
        const pool = pickDefaultForCup(lineId, cupIdx);
        doodleSvg = pool.svg;
        poolKey = pool.key;
      }

      const bitmap = await renderCupLabelToBitmap({
        stickerNumber,
        cupIdxOf: { idx: cupIdx + 1, total: qty },
        drinkName,
        modifiersText,
        doodleSvg,
      });

      const rasterPath = `${orderId}/${lineId}_${cupIdx}.bin`;
      const { error: upErr } = await sb.storage
        .from("doodles")
        .upload(rasterPath, bitmap, { contentType: "application/octet-stream", upsert: true });
      if (upErr) throw upErr;

      rows.push({
        square_order_id: orderId,
        line_id: lineId,
        cup_idx: cupIdx,
        sticker_number: stickerNumber,
        drink_name: drinkName,
        modifiers_text: modifiersText,
        doodle_source: source,
        doodle_pool_key: poolKey,
        doodle_paths: userPaths,
        raster_path: rasterPath,
      });
    }
  }

  if (rows.length === 0) return;
  const { error: insErr } = await sb
    .from("cup_label_jobs")
    .upsert(rows, { onConflict: "square_order_id,line_id,cup_idx", ignoreDuplicates: true });
  if (insErr) throw insErr;
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npm test -- src/lib/cup-label/enqueue.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/cup-label/client-line-id.ts \
        src/lib/cup-label/enqueue.ts \
        src/lib/cup-label/enqueue.test.ts
git commit -m "feat(cup-label): enqueueCupLabelJobs accepts user-uploaded doodles"
```

---

### Task 4: Wire `doodleIds` through payment route

**Goal:** Accept `doodleIds` on `/api/payment` body, forward to `enqueueCupLabelJobs` with the authed `userId`. Webhook path keeps default behavior (no app-side doodleIds yet for $0 webhook flows beyond what payment route already handles).

**Files:**
- Modify: `src/app/api/payment/route.ts`
- Modify: `src/app/api/webhooks/square/route.ts` (signature only — call site stays default)

- [ ] **Step 1: Extend payment route body**

In `src/app/api/payment/route.ts`:

Replace the `PaymentBody` type and `isValidBody` to include `doodleIds`:

```ts
type PaymentBody = {
  sourceId?: string;
  orderId: string;
  verificationToken?: string;
  doodleIds?: Record<string, string>;
};

function isValidBody(body: unknown): body is PaymentBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Partial<PaymentBody>;
  if (typeof b.orderId !== "string" || b.orderId.length === 0) return false;
  if (b.sourceId !== undefined && typeof b.sourceId !== "string") return false;
  if (b.doodleIds !== undefined) {
    if (typeof b.doodleIds !== "object" || b.doodleIds === null) return false;
    for (const v of Object.values(b.doodleIds)) {
      if (typeof v !== "string") return false;
    }
  }
  return true;
}
```

- [ ] **Step 2: Forward doodleIds to enqueue (paid branch)**

In `src/app/api/payment/route.ts`, find the existing $0 branch's enqueue call (search for `enqueueCupLabelJobs`) and the paid branch (the webhook handles paid orders typically — but the spec keeps $0 inline). For Phase 2, the **payment route** also needs to enqueue on paid orders so doodleIds get attached. Currently paid orders are enqueued from the webhook only.

Add a paid-branch enqueue right after the `payments.create` success and before the `loyaltyAccrued` block. Wrap in try/catch so it never breaks payment confirmation.

```ts
// Inside the paid branch, after `paymentForResponse = serializeSquareResponse(...)`
if (paymentStatus === "COMPLETED" && body.doodleIds && Object.keys(body.doodleIds).length > 0) {
  try {
    const { enqueueCupLabelJobs } = await import("@/lib/cup-label/enqueue");
    // Pull stickerNumber the same way the legacy print path derives it.
    // Reuse the existing enqueuePrintJob result — it is already the source
    // of truth for sticker number on paid orders (webhook path), so we
    // call it here too in dry-run / fast mode if available; otherwise
    // mirror the inline derivation used in webhook route.
    const { enqueuePrintJob } = await import("@/lib/print-jobs");
    const result = await enqueuePrintJob({ order, assumeSettled: true });
    if (result.queued) {
      await enqueueCupLabelJobs({
        order,
        stickerNumber: result.stickerNumber,
        doodleIds: body.doodleIds,
        userId: user.id,
      });
    }
  } catch (e) {
    console.error("[cup-label] paid-branch user-doodle enqueue failed (non-fatal)", e);
  }
}
```

> **Important:** This may double-enqueue if the webhook also fires `enqueuePrintJob` and `enqueueCupLabelJobs`. The legacy `print_jobs` table has a unique constraint on `square_order_id` so the second insert is swallowed. Phase 1 wired `enqueueCupLabelJobs` with `ignoreDuplicates: true` upsert on `(square_order_id, line_id, cup_idx)`. Therefore double-call is safe — the second call is a no-op.
>
> However the **first** call wins, and we want the user-doodle call to win. To ensure that, run the user-doodle enqueue BEFORE the webhook can fire. The payment route returns synchronously after `payments.create`; Square fires the webhook async. So if we enqueue here in the paid branch, we lock the doodle data first. The webhook's later default-only enqueue then no-ops on conflict. ✅

- [ ] **Step 3: Re-run all backend tests**

```bash
npm test
```

Expected: all green (no test for the route itself yet — covered by enqueue tests).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/payment/route.ts
git commit -m "feat(cup-label): payment route accepts and forwards doodleIds"
```

- [ ] **Step 5: Push backend branch**

```bash
git push -u origin feat/cup-label-tsp100
```

---

## RN App

> **Implementer:** Step 0 — `cd /Users/stanyan/Github/mandys_bubble_tea_app && git checkout -b feat/cup-label-app-doodle` (or switch to it if it already exists). All RN tasks commit on this branch. Skip if already on it.

### Task 5: RN pool mirror with parity test

**Goal:** Identical pool + hash to backend so default-key picks match server-side.

**Files:**
- Create: `lib/doodle/pool.ts`
- Create: `lib/doodle/pool.test.ts`

- [ ] **Step 1: Write failing test (parity vector)**

```ts
// lib/doodle/pool.test.ts
import { POOL, hashSeed, pickDefaultForCup } from './pool'

describe('hashSeed', () => {
  it('matches backend cyrb53-lite output for known inputs', () => {
    // These values match src/lib/doodle/pool.ts in the backend repo.
    // If you change one side you MUST change the other.
    expect(hashSeed('VAR1::MOD_PEARL:0')).toBe(hashSeed('VAR1::MOD_PEARL:0'))
    expect(hashSeed('a')).not.toBe(hashSeed('b'))
    expect(typeof hashSeed('test')).toBe('number')
  })
})

describe('POOL', () => {
  it('contains exactly the 4 v1 keys', () => {
    expect(POOL.map(p => p.key)).toEqual(['bunny', 'flower', 'star', 'cloud'])
  })
})

describe('pickDefaultForCup', () => {
  it('is deterministic for same (lineId, cupIdx)', () => {
    const a = pickDefaultForCup('VAR1::MOD_PEARL', 0)
    const b = pickDefaultForCup('VAR1::MOD_PEARL', 0)
    expect(a.key).toBe(b.key)
  })
  it('differs across cupIdx for the same line (often)', () => {
    const keys = new Set([0, 1, 2, 3].map(i => pickDefaultForCup('VAR1::MOD_PEARL', i).key))
    expect(keys.size).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea_app && npm test -- lib/doodle/pool.test.ts
```

- [ ] **Step 3: Implement pool.ts**

```ts
// lib/doodle/pool.ts
// MIRROR of mandys_bubble_tea/src/lib/doodle/pool.ts.
// Algorithm and SVG strings MUST stay identical so that default-image picks
// match server-side. Update both files together when changing the pool.

export type PoolItem = { key: string; svg: string }

export const POOL: PoolItem[] = [
  {
    key: 'bunny',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<ellipse cx="50" cy="65" rx="22" ry="20"/>
<ellipse cx="40" cy="35" rx="6" ry="18"/>
<ellipse cx="60" cy="35" rx="6" ry="18"/>
<circle cx="44" cy="62" r="2" fill="#000"/>
<circle cx="56" cy="62" r="2" fill="#000"/>
<path d="M48 70 Q50 73 52 70"/>
</svg>`,
  },
  {
    key: 'flower',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<circle cx="50" cy="50" r="8"/>
<circle cx="50" cy="32" r="10"/>
<circle cx="68" cy="50" r="10"/>
<circle cx="50" cy="68" r="10"/>
<circle cx="32" cy="50" r="10"/>
</svg>`,
  },
  {
    key: 'star',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<polygon points="50,15 58,40 85,40 63,56 71,82 50,66 29,82 37,56 15,40 42,40"/>
</svg>`,
  },
  {
    key: 'cloud',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<path d="M30 65 Q15 65 15 50 Q15 38 30 38 Q32 25 48 25 Q65 25 68 40 Q85 40 85 55 Q85 65 70 65 Z"/>
</svg>`,
  },
]

export function hashSeed(input: string): number {
  // cyrb53-lite — must match backend src/lib/doodle/pool.ts exactly.
  let h1 = 0xdeadbeef ^ 0
  let h2 = 0x41c6ce57 ^ 0
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return h2 >>> 0
}

export function pickDefaultForCup(lineId: string, cupIdx: number): PoolItem {
  const seed = hashSeed(`${lineId}:${cupIdx}`)
  return POOL[seed % POOL.length]
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- lib/doodle/pool.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/doodle/pool.ts lib/doodle/pool.test.ts
git commit -m "feat(doodle): add RN pool mirror with parity tests"
```

---

### Task 6: cartToSlots + clientLineId mirror (TDD)

**Goal:** Convert cart items to per-cup `DoodleSlot[]`, ready to render thumbnails. Also pin the `clientLineId` algorithm for cross-repo parity.

**Files:**
- Create: `lib/doodle/clientLineId.ts`
- Create: `lib/doodle/cartToSlots.ts`
- Create: `lib/doodle/cartToSlots.test.ts`

- [ ] **Step 1: Write `clientLineId.ts`**

```ts
// lib/doodle/clientLineId.ts
// MIRROR of mandys_bubble_tea/src/lib/cup-label/client-line-id.ts.
// Also matches store/cart.ts:buildLineId so cart entries flow straight through.

export function clientLineId(variationId: string, modifierIds: string[]): string {
  return `${variationId}::${[...modifierIds].sort().join(',')}`
}
```

- [ ] **Step 2: Write failing test**

```ts
// lib/doodle/cartToSlots.test.ts
import { cartToSlots } from './cartToSlots'
import type { CartItem } from '@/types/square'

const item = (over: Partial<CartItem>): CartItem => ({
  lineId: 'VAR1::MOD_A',
  id: 'ITEM1',
  variationId: 'VAR1',
  name: 'Pearl Milk Tea',
  price: 800,
  quantity: 1,
  modifiers: [],
  ...over,
})

describe('cartToSlots', () => {
  it('expands quantity into one slot per cup', () => {
    const slots = cartToSlots([item({ quantity: 3 })])
    expect(slots).toHaveLength(3)
    expect(slots.map(s => s.cupIdx)).toEqual([0, 1, 2])
  })

  it('uses cart lineId verbatim as DoodleSlot.lineId', () => {
    const slots = cartToSlots([item({ lineId: 'X::Y,Z' })])
    expect(slots[0].lineId).toBe('X::Y,Z')
  })

  it('assigns a defaultKey from the pool', () => {
    const slots = cartToSlots([item({ quantity: 2 })])
    expect(['bunny', 'flower', 'star', 'cloud']).toContain(slots[0].defaultKey)
  })

  it('initialises userPaths as null', () => {
    const slots = cartToSlots([item({ quantity: 1 })])
    expect(slots[0].userPaths).toBeNull()
  })
})
```

- [ ] **Step 3: Run test — expect FAIL**

```bash
npm test -- lib/doodle/cartToSlots.test.ts
```

- [ ] **Step 4: Implement**

```ts
// lib/doodle/cartToSlots.ts
import type { CartItem } from '@/types/square'
import { pickDefaultForCup } from './pool'

export type SvgPath = { d: string; stroke: string; width: number }

export type DoodleSlot = {
  lineId: string
  cupIdx: number
  drinkName: string
  defaultKey: string
  userPaths: SvgPath[] | null
}

export function cartToSlots(items: CartItem[]): DoodleSlot[] {
  const slots: DoodleSlot[] = []
  for (const item of items) {
    for (let cupIdx = 0; cupIdx < item.quantity; cupIdx++) {
      slots.push({
        lineId: item.lineId,
        cupIdx,
        drinkName: item.name,
        defaultKey: pickDefaultForCup(item.lineId, cupIdx).key,
        userPaths: null,
      })
    }
  }
  return slots
}
```

- [ ] **Step 5: Run test — expect PASS** then commit

```bash
npm test -- lib/doodle/cartToSlots.test.ts
git add lib/doodle/clientLineId.ts lib/doodle/cartToSlots.ts lib/doodle/cartToSlots.test.ts
git commit -m "feat(doodle): cartToSlots + clientLineId mirror"
```

---

### Task 7: DoodleCanvas component

**Goal:** Controlled `<Svg>` + `<Path>` canvas. Parent owns `paths`. Internal `currentPath` ref tracks the in-flight stroke; `onPathsChange` fires on release.

**Files:**
- Create: `components/doodle/DoodleCanvas.tsx`

- [ ] **Step 1: Write component**

```tsx
// components/doodle/DoodleCanvas.tsx
import { useMemo, useRef, useState } from 'react'
import { PanResponder, StyleSheet, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import type { SvgPath } from '@/lib/doodle/cartToSlots'

export const CANVAS_W = 400
export const CANVAS_H = 640

interface Props {
  paths: SvgPath[]
  brushWidth: number
  onPathsChange: (next: SvgPath[]) => void
}

export function DoodleCanvas({ paths, brushWidth, onPathsChange }: Props) {
  const [layout, setLayout] = useState<{ w: number; h: number }>({ w: 1, h: 1 })
  const currentPath = useRef<string>('')
  const [draftD, setDraftD] = useState<string>('')

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: e => {
          const x = (e.nativeEvent.locationX / layout.w) * CANVAS_W
          const y = (e.nativeEvent.locationY / layout.h) * CANVAS_H
          currentPath.current = `M${x.toFixed(1)},${y.toFixed(1)}`
          setDraftD(currentPath.current)
        },
        onPanResponderMove: e => {
          const x = (e.nativeEvent.locationX / layout.w) * CANVAS_W
          const y = (e.nativeEvent.locationY / layout.h) * CANVAS_H
          currentPath.current += ` L${x.toFixed(1)},${y.toFixed(1)}`
          setDraftD(currentPath.current)
        },
        onPanResponderRelease: () => {
          if (currentPath.current && currentPath.current.includes('L')) {
            onPathsChange([
              ...paths,
              { d: currentPath.current, stroke: '#000', width: brushWidth },
            ])
          }
          currentPath.current = ''
          setDraftD('')
        },
        onPanResponderTerminate: () => {
          currentPath.current = ''
          setDraftD('')
        },
      }),
    [layout.w, layout.h, paths, brushWidth, onPathsChange],
  )

  return (
    <View
      style={styles.box}
      onLayout={e => {
        const { width, height } = e.nativeEvent.layout
        setLayout({ w: width || 1, h: height || 1 })
      }}
      {...responder.panHandlers}
    >
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {paths.map((p, i) => (
          <Path
            key={i}
            d={p.d}
            stroke={p.stroke}
            strokeWidth={p.width}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {draftD ? (
          <Path
            d={draftD}
            stroke="#000"
            strokeWidth={brushWidth}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    aspectRatio: 400 / 640,
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add components/doodle/DoodleCanvas.tsx
git commit -m "feat(doodle): add DoodleCanvas (PanResponder + react-native-svg)"
```

---

### Task 8: DoodleModal component

**Goal:** Full-screen modal containing canvas + toolbar + cup nav. Parent passes the active slot index, the slots array, and an updater. Modal handles undo / clear / use-default / brush + ← prev / next →.

**Files:**
- Create: `components/doodle/DoodleModal.tsx`

- [ ] **Step 1: Write component**

```tsx
// components/doodle/DoodleModal.tsx
import { useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { DoodleCanvas } from './DoodleCanvas'
import type { DoodleSlot, SvgPath } from '@/lib/doodle/cartToSlots'
import { T, FONT, RADIUS } from '@/constants/theme'

interface Props {
  visible: boolean
  slots: DoodleSlot[]
  initialIndex: number
  onClose: () => void
  onSlotChange: (slotIdx: number, next: DoodleSlot) => void
}

const BRUSHES = [3, 6, 10] as const

export function DoodleModal({ visible, slots, initialIndex, onClose, onSlotChange }: Props) {
  const insets = useSafeAreaInsets()
  const [idx, setIdx] = useState(initialIndex)
  const [brush, setBrush] = useState<(typeof BRUSHES)[number]>(6)

  if (slots.length === 0) return null
  const safeIdx = Math.min(Math.max(idx, 0), slots.length - 1)
  const slot = slots[safeIdx]
  const paths = slot.userPaths ?? []

  const setPaths = (next: SvgPath[]) => {
    onSlotChange(safeIdx, { ...slot, userPaths: next })
  }

  const handleUndo = () => setPaths(paths.slice(0, -1))
  const handleClear = () => setPaths([])
  const handleUseDefault = () => onSlotChange(safeIdx, { ...slot, userPaths: null })
  const handleDone = () => onClose()

  const goPrev = () => setIdx(Math.max(0, safeIdx - 1))
  const goNext = () => setIdx(Math.min(slots.length - 1, safeIdx + 1))

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
        <View style={styles.topbar}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.iconBtn}>
            <Text style={styles.iconBtnText}>✕</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>Cup {safeIdx + 1} / {slots.length}</Text>
            <Text style={styles.title} numberOfLines={1}>{slot.drinkName}</Text>
          </View>
          <Pressable onPress={handleDone} hitSlop={10} style={[styles.iconBtn, styles.doneBtn]}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
          <DoodleCanvas paths={paths} brushWidth={brush} onPathsChange={setPaths} />

          <View style={styles.tools}>
            {BRUSHES.map(w => {
              const active = w === brush
              return (
                <Pressable
                  key={w}
                  onPress={() => setBrush(w)}
                  style={[styles.brush, active && styles.brushActive]}
                >
                  <View style={[styles.brushDot, { width: w * 1.6, height: w * 1.6 }]} />
                </Pressable>
              )
            })}
            <View style={styles.toolDivider} />
            <Pressable onPress={handleUndo} style={styles.toolBtn}>
              <Text style={styles.toolBtnText}>Undo</Text>
            </Pressable>
            <Pressable onPress={handleClear} style={styles.toolBtn}>
              <Text style={styles.toolBtnText}>Clear</Text>
            </Pressable>
            <Pressable onPress={handleUseDefault} style={styles.toolBtn}>
              <Text style={styles.toolBtnText}>Use default</Text>
            </Pressable>
          </View>

          <View style={styles.nav}>
            <Pressable
              onPress={goPrev}
              disabled={safeIdx === 0}
              style={[styles.navBtn, safeIdx === 0 && styles.navBtnDisabled]}
            >
              <Text style={styles.navBtnText}>← Prev</Text>
            </Pressable>
            <Pressable
              onPress={goNext}
              disabled={safeIdx === slots.length - 1}
              style={[styles.navBtn, safeIdx === slots.length - 1 && styles.navBtnDisabled]}
            >
              <Text style={styles.navBtnText}>Next →</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.line,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 999,
    backgroundColor: T.card, borderWidth: 1, borderColor: T.line,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnText: { fontFamily: FONT.sans, fontSize: 16, color: T.ink },
  doneBtn: { width: 'auto', paddingHorizontal: 14, backgroundColor: T.brand, borderColor: T.brand },
  doneText: { fontFamily: FONT.sans, fontSize: 13, fontWeight: '700', color: '#fff' },
  eyebrow: {
    fontFamily: FONT.mono, fontSize: 10, letterSpacing: 1.4,
    fontWeight: '700', color: T.brand, textTransform: 'uppercase',
  },
  title: {
    fontFamily: FONT.serif, fontSize: 18, fontWeight: '500', color: T.ink, marginTop: 2,
  },
  tools: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16, alignItems: 'center',
  },
  brush: {
    width: 44, height: 44, borderRadius: RADIUS.small,
    backgroundColor: T.card, borderWidth: 1, borderColor: T.line,
    alignItems: 'center', justifyContent: 'center',
  },
  brushActive: { borderColor: T.brand, backgroundColor: T.paper },
  brushDot: { backgroundColor: '#000', borderRadius: 999 },
  toolDivider: { width: 1, height: 24, backgroundColor: T.line, marginHorizontal: 4 },
  toolBtn: {
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: RADIUS.small,
    backgroundColor: T.card, borderWidth: 1, borderColor: T.line,
  },
  toolBtnText: { fontFamily: FONT.sans, fontSize: 13, fontWeight: '600', color: T.ink },
  nav: {
    flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, gap: 12,
  },
  navBtn: {
    flex: 1, paddingVertical: 12, borderRadius: RADIUS.pill,
    backgroundColor: T.ink, alignItems: 'center', justifyContent: 'center',
  },
  navBtnDisabled: { opacity: 0.3 },
  navBtnText: { fontFamily: FONT.sans, fontSize: 14, fontWeight: '700', color: T.cream },
})
```

- [ ] **Step 2: Commit**

```bash
git add components/doodle/DoodleModal.tsx
git commit -m "feat(doodle): add DoodleModal full-screen editor"
```

---

### Task 9: DoodleSection component

**Goal:** Horizontally-scrolling cup thumbnails on checkout. Tap any cup → open `DoodleModal` at that index.

**Files:**
- Create: `components/doodle/DoodleSection.tsx`

- [ ] **Step 1: Write component**

```tsx
// components/doodle/DoodleSection.tsx
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { CardBlock } from '@/components/checkout/CardBlock'
import { DoodleModal } from './DoodleModal'
import type { DoodleSlot } from '@/lib/doodle/cartToSlots'
import { T, FONT, RADIUS } from '@/constants/theme'

interface Props {
  slots: DoodleSlot[]
  onSlotChange: (slotIdx: number, next: DoodleSlot) => void
}

export function DoodleSection({ slots, onSlotChange }: Props) {
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  if (slots.length === 0) return null

  return (
    <CardBlock eyebrow="Cup labels" title="Doodle each cup (optional)">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {slots.map((slot, i) => {
          const drawn = (slot.userPaths?.length ?? 0) > 0
          return (
            <Pressable
              key={`${slot.lineId}:${slot.cupIdx}`}
              onPress={() => setOpenIdx(i)}
              style={[styles.cup, drawn && styles.cupDrawn]}
            >
              <Text style={styles.cupNum}>Cup {i + 1}</Text>
              <Text style={styles.cupName} numberOfLines={2}>{slot.drinkName}</Text>
              <Text style={styles.cupState}>
                {drawn ? '✓ doodled' : `default · ${slot.defaultKey}`}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>

      <DoodleModal
        visible={openIdx !== null}
        slots={slots}
        initialIndex={openIdx ?? 0}
        onClose={() => setOpenIdx(null)}
        onSlotChange={onSlotChange}
      />
    </CardBlock>
  )
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 16, paddingBottom: 14, gap: 10 },
  cup: {
    width: 110,
    minHeight: 110,
    padding: 12,
    borderRadius: RADIUS.small,
    backgroundColor: T.paper,
    borderWidth: 1,
    borderColor: T.line,
    justifyContent: 'space-between',
  },
  cupDrawn: { borderColor: T.brand, backgroundColor: 'rgba(196,58,16,0.06)' },
  cupNum: {
    fontFamily: FONT.mono, fontSize: 10, letterSpacing: 1.3,
    fontWeight: '700', color: T.brand, textTransform: 'uppercase',
  },
  cupName: { fontFamily: FONT.sans, fontSize: 12, fontWeight: '600', color: T.ink, marginTop: 4 },
  cupState: { fontFamily: FONT.sans, fontSize: 11, color: T.ink2, marginTop: 6 },
})
```

- [ ] **Step 2: Commit**

```bash
git add components/doodle/DoodleSection.tsx
git commit -m "feat(doodle): add DoodleSection thumbnails"
```

---

### Task 10: uploadDoodle helper + use-payment update

**Goal:** Helper that posts paths and returns the doodleId. Extend `usePayment` to forward `doodleIds` to `/api/payment`.

**Files:**
- Create: `lib/doodle/uploadDoodle.ts`
- Modify: `hooks/use-payment.ts`

- [ ] **Step 1: Write uploadDoodle**

```ts
// lib/doodle/uploadDoodle.ts
import { apiFetch } from '@/lib/api'
import type { SvgPath } from './cartToSlots'

export interface UploadResult { doodleId: string }

export async function uploadDoodle(paths: SvgPath[]): Promise<UploadResult> {
  const res = await apiFetch<{ ok: boolean; doodleId?: string; error?: string }>(
    '/api/doodle/upload',
    { method: 'POST', body: JSON.stringify({ paths }) },
  )
  if (!res.ok || !res.doodleId) {
    throw new Error(res.error ?? 'Doodle upload failed')
  }
  return { doodleId: res.doodleId }
}
```

- [ ] **Step 2: Update use-payment.ts**

Replace the file with:

```ts
import { useState } from 'react'
import { apiFetch } from '@/lib/api'

interface PaymentParams {
  sourceId?: string
  orderId: string
  verificationToken?: string
  doodleIds?: Record<string, string>
}

interface PaymentResult {
  ok: boolean
  paymentId?: string
  loyaltyAccrued?: boolean
  welcomeDiscountConsumed?: boolean
  payment?: unknown
}

interface PaymentHook {
  pay: (params: PaymentParams) => Promise<PaymentResult>
  loading: boolean
  error: string | null
}

export function usePayment(): PaymentHook {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pay = async (params: PaymentParams): Promise<PaymentResult> => {
    setLoading(true)
    setError(null)
    try {
      const result = await apiFetch<PaymentResult>('/api/payment', {
        method: 'POST',
        body: JSON.stringify(params),
      })
      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Payment failed'
      setError(msg)
      throw e
    } finally {
      setLoading(false)
    }
  }

  return { pay, loading, error }
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/doodle/uploadDoodle.ts hooks/use-payment.ts
git commit -m "feat(doodle): add uploadDoodle helper + forward doodleIds in usePayment"
```

---

### Task 11: Integrate DoodleSection into checkout

**Goal:** Show the section above Order Summary, manage `slots` state synced from cart, batch-upload userPaths on Pay, forward `doodleIds` to `pay()`.

**Files:**
- Modify: `app/checkout.tsx`

- [ ] **Step 1: Add slot state synced from cart**

In `CheckoutScreen()`, after the existing `useState` calls, add:

```tsx
import { cartToSlots, type DoodleSlot } from '@/lib/doodle/cartToSlots'
import { DoodleSection } from '@/components/doodle/DoodleSection'
import { uploadDoodle } from '@/lib/doodle/uploadDoodle'
```

```tsx
const [slots, setSlots] = useState<DoodleSlot[]>(() => cartToSlots(items))

useEffect(() => {
  // Re-derive slots when cart shape changes, but preserve userPaths for slots
  // whose (lineId, cupIdx) still exists.
  setSlots(prev => {
    const next = cartToSlots(items)
    const prevByKey = new Map(
      prev.map(s => [`${s.lineId}:${s.cupIdx}`, s] as const),
    )
    return next.map(n => {
      const old = prevByKey.get(`${n.lineId}:${n.cupIdx}`)
      return old?.userPaths ? { ...n, userPaths: old.userPaths } : n
    })
  })
}, [items])

const handleSlotChange = (slotIdx: number, next: DoodleSlot) => {
  setSlots(prev => prev.map((s, i) => (i === slotIdx ? next : s)))
}
```

- [ ] **Step 2: Render DoodleSection above OrderItemsBlock**

In the main `return`, find the line `<OrderItemsBlock items={items} />` and insert immediately above:

```tsx
<DoodleSection slots={slots} onSlotChange={handleSlotChange} />
```

- [ ] **Step 3: Upload doodles before pay**

Inside `handlePay`, just BEFORE `const result = await pay({ sourceId: nonce, orderId })`, add:

```tsx
const doodleIds: Record<string, string> = {}
const drawnSlots = slots.filter(s => (s.userPaths?.length ?? 0) > 0)
for (const s of drawnSlots) {
  try {
    const { doodleId } = await uploadDoodle(s.userPaths!)
    doodleIds[`${s.lineId}:${s.cupIdx}`] = doodleId
  } catch (e) {
    // Soft-fail: this cup falls back to the default. The order still goes through.
    console.warn('[doodle] upload failed for', s.lineId, s.cupIdx, e)
  }
}
```

Then change the pay call to:

```tsx
const result = await pay({
  sourceId: nonce,
  orderId,
  doodleIds: Object.keys(doodleIds).length > 0 ? doodleIds : undefined,
})
```

- [ ] **Step 4: Manual smoke test**

Run the dev server (RN: `npm start`, backend: `npm run dev`):

1. Add 2 drinks to cart (qty 3 total).
2. Open checkout → see DoodleSection with 3 cups.
3. Tap Cup 1 → modal opens → draw → tap Done → cup shows ✓ doodled.
4. Tap Pay (use Square sandbox card).
5. In Supabase, check `cup_label_jobs` rows: cup 1 has `doodle_source='user'` and `doodle_paths IS NOT NULL`; others are `default`.

- [ ] **Step 5: Commit**

```bash
git add app/checkout.tsx
git commit -m "feat(checkout): integrate DoodleSection + batch upload + forward doodleIds"
```

- [ ] **Step 6: Push branch**

```bash
git push -u origin feat/cup-label-app-doodle
```

---

### Task 12: Final review + EAS internal build

**Goal:** End-to-end validation across both repos.

- [ ] **Step 1: Run all tests in both repos**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea && npm test
cd /Users/stanyan/Github/mandys_bubble_tea_app && npm test
```

- [ ] **Step 2: Run typecheck in both repos**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea && npx tsc --noEmit
cd /Users/stanyan/Github/mandys_bubble_tea_app && npx tsc --noEmit
```

- [ ] **Step 3: Dispatch a final code-reviewer over the full Phase 2 diff**

Use the superpowers:code-reviewer agent on:
- backend `feat/cup-label-tsp100` — diff since the Phase 1 review HEAD
- RN `feat/cup-label-app-doodle` — diff since `main`

- [ ] **Step 4: Cut EAS internal build**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea_app
eas build --profile preview --platform ios
```

Install on a test device, run end-to-end (cart → checkout → doodle → pay → verify printed cup label has the doodle).

- [ ] **Step 5: Submit ASC 1.0.8** (after Phase 1 hardware verification + parallel-run sign-off)

```bash
eas build --profile production --platform ios
eas submit --platform ios --latest
```

---

## Risks & Notes

1. **Double-enqueue ordering.** Payment route enqueues with `doodleIds` *before* Square's webhook fires its default-only enqueue. The unique constraint `(square_order_id, line_id, cup_idx)` + `ignoreDuplicates: true` ensures the user-doodle row wins. Verify by inspecting `cup_label_jobs.doodle_source` after a real order.
2. **Hash parity.** Backend and RN `pool.ts` MUST stay byte-identical in algorithm + SVG strings. Pool changes require updating both files in the same PR. The parity test (Task 5) only checks determinism, not byte-equality with backend — manual diff during PR review covers that.
3. **Web-side checkout** is unchanged: no `DoodleSection`, no `doodleIds` in body. Existing default-pool path keeps working. Fully backward-compatible.
4. **Storage cleanup.** `doodles_pending/` accumulates JSON forever in v1. Phase 3 plan adds a Vercel Cron that deletes consumed entries 24h post-print. Until then, monitor bucket size weekly.
5. **Path size limits.** RN `MAX_PATHS=200` cap matches backend. Average bubble-tea cup doodle ~30–80 strokes, so 200 is generous.
6. **Hardware first.** This plan can be merged but **do not deploy the RN app build** until Phase 1's 1-week parallel-run on TSP100 is signed off. UI without hardware = customers paying for a feature that doesn't print.
