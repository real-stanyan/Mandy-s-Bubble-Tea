# Phase 1: Backend + Default Pool + CloudPRNT Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the entire TSP100 + CloudPRNT print pipeline running **in parallel** with the existing Zebra ZD411 path. Every paid order writes to BOTH `print_jobs` (untouched) and the new `cup_label_jobs`. TSP100 prints default-pool doodles on every cup; ZD411 keeps printing as today. No app-side changes in this phase. Verifies the new printer works for 1 week before any cutover.

**Architecture:** New independent table `cup_label_jobs` (one row per cup, per-cup status). New storage buckets `doodles/` and `doodles_pool/`. Default pool of 4 black-and-white SVG images is pre-rendered to Star raster on deploy. Order-creation hook enqueues a `cup_label_jobs` row per cup with the default doodle (no user input yet). Star TSP100IV SK polls `/api/cloudprnt/poll` every 5s, prints, and acks `/api/cloudprnt/ack`.

**Tech Stack:**
- Next.js 14 App Router (read `node_modules/next/dist/docs/` if API patterns are unclear — see AGENTS.md warning)
- Supabase Postgres + Storage
- `resvg-js` (new dep) for SVG → PNG
- `sharp` ^0.34.5 (already installed) for compositing + 1-bit threshold
- Star raster ESC/GS commands (custom)

**Spec:** `docs/superpowers/specs/2026-04-27-checkout-doodle-cup-label-design.md`

**Important constraint:** This phase MUST NOT change behavior of `print_jobs`, `enqueuePrintJob`, `printer-client/`, ZD411, or anything Mac mini-related. The new path is purely additive.

---

## File Structure

| Path | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Modify | Add `@resvg/resvg-js` dep |
| `supabase/migrations/2026-04-27-cup-label-jobs.sql` | Create | New table `cup_label_jobs`, RLS, realtime |
| `supabase/migrations/2026-04-27-doodles-storage.sql` | Create | Buckets `doodles` + `doodles_pool` |
| `src/lib/doodle/pool.ts` | Create | Default pool config + `pickDefaultForCup(lineId, cupIdx)` |
| `src/lib/doodle/pool.test.ts` | Create | Unit test for stable hash + pool selection |
| `src/lib/doodle/render-svg.ts` | Create | SVG paths JSON → PNG buffer (resvg) |
| `src/lib/doodle/render-svg.test.ts` | Create | Golden PNG comparison |
| `src/lib/cup-label/render-tsp100.ts` | Create | Sandwich layout: top reverse + middle doodle + bottom modifiers → 1-bit raster |
| `src/lib/cup-label/render-tsp100.test.ts` | Create | Golden raster comparison |
| `src/lib/star/raster.ts` | Create | ESC/GS command builder for TSP100 raster job |
| `src/lib/star/raster.test.ts` | Create | Golden byte-level comparison for raster command stream |
| `src/lib/cup-label/enqueue.ts` | Create | `enqueueCupLabelJobs(order)` — extracts cups, picks default doodle per cup, inserts rows |
| `src/lib/cup-label/enqueue.test.ts` | Create | Unit test |
| `src/app/api/cloudprnt/poll/route.ts` | Create | Star printer polling endpoint |
| `src/app/api/cloudprnt/ack/route.ts` | Create | Star printer ack endpoint |
| `src/app/api/admin/cup-label/test-print/route.ts` | Create | Manual test trigger (admin-only) |
| `src/lib/print-jobs.ts` | Modify | After existing `enqueuePrintJob` call site, also call `enqueueCupLabelJobs` |
| `scripts/render-default-pool.ts` | Create | One-off script: pre-render 4 default svgs to raster, upload to `doodles_pool` bucket |
| `docs/operations/tsp100-setup.md` | Create | Hardware setup runbook |

---

## Task 1: Add resvg-js dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install dep**

```bash
npm install @resvg/resvg-js@^2.6.2
```

- [ ] **Step 2: Verify it loads in Node**

Run:
```bash
node -e "const {Resvg} = require('@resvg/resvg-js'); console.log(typeof Resvg)"
```
Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add @resvg/resvg-js for doodle SVG rendering"
```

---

## Task 2: Migration — `cup_label_jobs` table

**Files:**
- Create: `supabase/migrations/2026-04-27-cup-label-jobs.sql`

- [ ] **Step 1: Write migration**

```sql
-- New per-cup CloudPRNT job table for TSP100IV SK pipeline.
-- Lives ALONGSIDE existing print_jobs (ZD411/ZPL path) — does not replace it.
-- See docs/superpowers/specs/2026-04-27-checkout-doodle-cup-label-design.md

create table if not exists cup_label_jobs (
  id                uuid primary key default gen_random_uuid(),
  square_order_id   text not null,
  line_id           text not null,
  cup_idx           int  not null,
  sticker_number    text not null,
  drink_name        text not null,
  modifiers_text    text not null,             -- single string, "Pearl×2 · Aloe · 50%S · Warm"
  doodle_source     text not null check (doodle_source in ('user','default')),
  doodle_pool_key   text,                      -- non-null when source='default'
  doodle_paths      jsonb,                     -- non-null when source='user'
  raster_path       text not null,             -- supabase storage object path of full label raster bin
  status            text not null default 'pending'
                       check (status in ('pending','printing','printed','failed')),
  attempts          int  not null default 0,
  last_error        text,
  printer_token     text,                      -- set when poll hands the job to a printer (for ack matching)
  created_at        timestamptz not null default now(),
  printed_at        timestamptz,
  unique(square_order_id, line_id, cup_idx)
);

create index if not exists cup_label_jobs_status_created_idx
  on cup_label_jobs (status, created_at);

create index if not exists cup_label_jobs_order_idx
  on cup_label_jobs (square_order_id);

alter publication supabase_realtime add table cup_label_jobs;

alter table cup_label_jobs enable row level security;
-- service-role-only access; no client policies.
```

- [ ] **Step 2: Apply migration**

Run:
```bash
npx supabase db push
```
Expected: `Applying migration 2026-04-27-cup-label-jobs.sql ... done`

- [ ] **Step 3: Verify table exists**

Run:
```bash
npx supabase db diff --schema public | head -30
```
Expected: no diff (migration applied cleanly).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/2026-04-27-cup-label-jobs.sql
git commit -m "feat(db): add cup_label_jobs table for TSP100 CloudPRNT pipeline"
```

---

## Task 3: Migration — Storage buckets

**Files:**
- Create: `supabase/migrations/2026-04-27-doodles-storage.sql`

- [ ] **Step 1: Write migration**

```sql
-- Storage buckets for doodle artefacts.
-- doodles/        — per-order user-or-default rendered PNG + raster .bin (24h GC)
-- doodles_pool/   — pre-rendered default pool raster bins (permanent)

insert into storage.buckets (id, name, public, file_size_limit)
  values
    ('doodles', 'doodles', false, 1048576),         -- 1MB
    ('doodles_pool', 'doodles_pool', false, 524288) -- 512KB
  on conflict (id) do nothing;

-- service-role only — no policies.
```

- [ ] **Step 2: Apply**

Run:
```bash
npx supabase db push
```
Expected: clean apply.

- [ ] **Step 3: Verify**

Run:
```bash
npx supabase storage ls
```
Expected: lists `doodles` and `doodles_pool`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/2026-04-27-doodles-storage.sql
git commit -m "feat(storage): add doodles and doodles_pool buckets"
```

---

## Task 4: Default pool config + stable hash (TDD)

**Files:**
- Create: `src/lib/doodle/pool.ts`
- Create: `src/lib/doodle/pool.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/lib/doodle/pool.test.ts
import { describe, it, expect } from "vitest";
import { POOL, pickDefaultForCup, hashSeed } from "./pool";

describe("default doodle pool", () => {
  it("has at least 4 entries", () => {
    expect(POOL.length).toBeGreaterThanOrEqual(4);
  });

  it("every entry has key + svg", () => {
    for (const item of POOL) {
      expect(item.key).toMatch(/^[a-z][a-z0-9_-]*$/);
      expect(item.svg.startsWith("<svg")).toBe(true);
    }
  });

  it("pickDefaultForCup is stable for same (lineId, cupIdx)", () => {
    const a = pickDefaultForCup("line-abc", 0);
    const b = pickDefaultForCup("line-abc", 0);
    expect(a.key).toBe(b.key);
  });

  it("pickDefaultForCup distributes across pool over many inputs", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(pickDefaultForCup(`line-${i}`, 0).key);
    }
    expect(seen.size).toBeGreaterThanOrEqual(POOL.length);
  });

  it("hashSeed is deterministic", () => {
    expect(hashSeed("foo:0")).toBe(hashSeed("foo:0"));
  });
});
```

- [ ] **Step 2: Run test, confirm fails**

Run: `npx vitest run src/lib/doodle/pool.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/doodle/pool.ts
import "server-only";

export type PoolItem = { key: string; svg: string };

// v1 placeholder doodles — clean black-on-transparent SVGs.
// These will be replaced with sourced Mandy IP art in a follow-up;
// the API stays the same.
export const POOL: PoolItem[] = [
  {
    key: "bunny",
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
    key: "flower",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<circle cx="50" cy="50" r="8"/>
<circle cx="50" cy="32" r="10"/>
<circle cx="68" cy="50" r="10"/>
<circle cx="50" cy="68" r="10"/>
<circle cx="32" cy="50" r="10"/>
</svg>`,
  },
  {
    key: "star",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<polygon points="50,15 58,40 85,40 63,56 71,82 50,66 29,82 37,56 15,40 42,40"/>
</svg>`,
  },
  {
    key: "cloud",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<path d="M30 65 Q15 65 15 50 Q15 38 30 38 Q32 25 48 25 Q65 25 68 40 Q85 40 85 55 Q85 65 70 65 Z"/>
</svg>`,
  },
];

export function hashSeed(input: string): number {
  // cyrb53-lite — deterministic, fast, no deps.
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0);
}

export function pickDefaultForCup(lineId: string, cupIdx: number): PoolItem {
  const seed = hashSeed(`${lineId}:${cupIdx}`);
  return POOL[seed % POOL.length];
}
```

- [ ] **Step 4: Run test, confirm passes**

Run: `npx vitest run src/lib/doodle/pool.test.ts`
Expected: PASS — all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/doodle/pool.ts src/lib/doodle/pool.test.ts
git commit -m "feat(doodle): default pool with stable per-cup hash"
```

---

## Task 5: SVG → PNG renderer (TDD)

**Files:**
- Create: `src/lib/doodle/render-svg.ts`
- Create: `src/lib/doodle/render-svg.test.ts`
- Create: `src/lib/__fixtures__/doodle-bunny-golden.png` (from test run output)

- [ ] **Step 1: Write failing test**

```ts
// src/lib/doodle/render-svg.test.ts
import { describe, it, expect } from "vitest";
import { renderSvgToPng } from "./render-svg";
import { POOL } from "./pool";

describe("renderSvgToPng", () => {
  it("renders pool svg to PNG buffer at requested size", async () => {
    const buf = await renderSvgToPng(POOL[0].svg, { widthPx: 360, heightPx: 360 });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(100);
    // PNG magic bytes
    expect(buf.slice(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  it("renders user svg paths JSON to PNG", async () => {
    const paths = [
      { d: "M10,10 L50,50 L90,10", stroke: "#000", width: 4 },
    ];
    const buf = await renderSvgToPng(pathsToSvg(paths, 360), { widthPx: 360, heightPx: 360 });
    expect(buf.slice(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });
});

function pathsToSvg(paths: { d: string; stroke: string; width: number }[], size: number) {
  const inner = paths.map(p => `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${inner}</svg>`;
}
```

- [ ] **Step 2: Run test, confirm fails**

Run: `npx vitest run src/lib/doodle/render-svg.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/doodle/render-svg.ts
import "server-only";
import { Resvg } from "@resvg/resvg-js";

export type RenderOpts = { widthPx: number; heightPx: number };

export async function renderSvgToPng(svg: string, opts: RenderOpts): Promise<Buffer> {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: opts.widthPx },
    background: "rgba(255,255,255,1)",
  });
  return Buffer.from(resvg.render().asPng());
}

export type SvgPath = { d: string; stroke: string; width: number };

export function pathsJsonToSvg(paths: SvgPath[], canvasSize: number): string {
  const body = paths
    .map(
      p =>
        `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasSize} ${canvasSize}">${body}</svg>`;
}
```

- [ ] **Step 4: Run test, confirm passes**

Run: `npx vitest run src/lib/doodle/render-svg.test.ts`
Expected: PASS — both tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/doodle/render-svg.ts src/lib/doodle/render-svg.test.ts
git commit -m "feat(doodle): SVG → PNG renderer via resvg-js"
```

---

## Task 6: Star raster command builder (TDD with golden bytes)

**Files:**
- Create: `src/lib/star/raster.ts`
- Create: `src/lib/star/raster.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/lib/star/raster.test.ts
import { describe, it, expect } from "vitest";
import { buildLabelJob, encodeWidthBytes } from "./raster";

describe("Star raster command builder", () => {
  it("encodes width as little-endian 2-byte int", () => {
    expect([...encodeWidthBytes(50)]).toEqual([0x32, 0x00]);
    expect([...encodeWidthBytes(400)]).toEqual([0x90, 0x01]);
  });

  it("wraps raster in correct ESC/GS envelope", () => {
    const widthBytes = 50;       // 400 dots / 8
    const heightDots = 640;
    const bitmap = Buffer.alloc(widthBytes * heightDots, 0); // all zeros
    const job = buildLabelJob(bitmap, widthBytes, heightDots);

    // First 2 bytes: ESC @ initialize
    expect([job[0], job[1]]).toEqual([0x1b, 0x40]);
    // Followed by gap-sensor enable
    expect([job[2], job[3], job[4], job[5]]).toEqual([0x1b, 0x1d, 0x61, 0x01]);
    // Should end with form feed to next gap
    const tail = job.slice(-3);
    expect([...tail]).toEqual([0x1b, 0x64, 0x02]);
    // Bitmap bytes should appear unchanged inside the buffer
    expect(job.includes(bitmap)).toBe(true);
  });

  it("rejects mismatched bitmap size", () => {
    expect(() =>
      buildLabelJob(Buffer.alloc(10), /* widthBytes */ 50, /* heightDots */ 640),
    ).toThrow(/bitmap size/);
  });
});
```

- [ ] **Step 2: Run test, confirm fails**

Run: `npx vitest run src/lib/star/raster.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/star/raster.ts
// Star Micronics ESC/GS raster command builder for TSP100IV SK in CloudPRNT mode.
// Reference: Star Programming Manual, "Set Bit Image (raster format)" + "Form feed to next die-cut gap".

const ESC = 0x1b;
const GS = 0x1d;

export function encodeWidthBytes(widthBytes: number): Buffer {
  if (widthBytes < 0 || widthBytes > 0xffff) throw new Error("widthBytes out of range");
  const b = Buffer.alloc(2);
  b[0] = widthBytes & 0xff;
  b[1] = (widthBytes >>> 8) & 0xff;
  return b;
}

export function buildLabelJob(bitmap: Buffer, widthBytes: number, heightDots: number): Buffer {
  if (bitmap.length !== widthBytes * heightDots) {
    throw new Error(`bitmap size ${bitmap.length} != widthBytes(${widthBytes}) * heightDots(${heightDots})`);
  }

  const init           = Buffer.from([ESC, 0x40]);                  // initialize
  const enableGap      = Buffer.from([ESC, GS, 0x61, 0x01]);        // die-cut gap sensor on
  const enterRaster    = Buffer.from([ESC, 0x2a, 0x72, 0x41]);      // raster mode begin
  const setWidthCmd    = Buffer.from([ESC, 0x2a, 0x72, 0x52, widthBytes & 0xff, (widthBytes >>> 8) & 0xff]);
  const exitRaster     = Buffer.from([ESC, 0x2a, 0x72, 0x42]);      // raster mode end
  const formFeedToGap  = Buffer.from([ESC, 0x64, 0x02]);            // feed to next die-cut gap

  return Buffer.concat([
    init,
    enableGap,
    enterRaster,
    setWidthCmd,
    bitmap,
    exitRaster,
    formFeedToGap,
  ]);
}
```

- [ ] **Step 4: Run test, confirm passes**

Run: `npx vitest run src/lib/star/raster.test.ts`
Expected: PASS — all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/star/raster.ts src/lib/star/raster.test.ts
git commit -m "feat(star): TSP100 raster ESC/GS command builder"
```

---

## Task 7: Sandwich label compositor (TDD)

**Files:**
- Create: `src/lib/cup-label/render-tsp100.ts`
- Create: `src/lib/cup-label/render-tsp100.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/lib/cup-label/render-tsp100.test.ts
import { describe, it, expect } from "vitest";
import { renderCupLabelToBitmap, LABEL_WIDTH_DOTS, LABEL_HEIGHT_DOTS } from "./render-tsp100";
import { POOL } from "../doodle/pool";

describe("TSP100 sandwich label compositor", () => {
  it("produces a bitmap of exact 50x80mm @ 203 DPI", async () => {
    const bm = await renderCupLabelToBitmap({
      stickerNumber: "OL856",
      cupIdxOf: { idx: 1, total: 2 },
      drinkName: "Pearl Milk Tea",
      modifiersText: "L · Pearl×2 · 50%S · Warm",
      doodleSvg: POOL[0].svg,
    });
    const widthBytes = LABEL_WIDTH_DOTS / 8;
    expect(bm.length).toBe(widthBytes * LABEL_HEIGHT_DOTS);
    expect(LABEL_WIDTH_DOTS).toBe(400);
    expect(LABEL_HEIGHT_DOTS).toBe(640);
  });

  it("returns 1-bit packed bitmap (every byte is 0..255 of 8 packed pixels)", async () => {
    const bm = await renderCupLabelToBitmap({
      stickerNumber: "OL000",
      cupIdxOf: { idx: 1, total: 1 },
      drinkName: "Test",
      modifiersText: "M",
      doodleSvg: POOL[0].svg,
    });
    // Just sanity check: not all zeros, not all 0xff.
    const allZero = bm.every(b => b === 0);
    const allFf = bm.every(b => b === 0xff);
    expect(allZero).toBe(false);
    expect(allFf).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, confirm fails**

Run: `npx vitest run src/lib/cup-label/render-tsp100.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/cup-label/render-tsp100.ts
import "server-only";
import sharp from "sharp";
import { renderSvgToPng } from "../doodle/render-svg";

// 50 mm x 80 mm at 203 DPI -> 400 x 640 dots
export const LABEL_WIDTH_DOTS = 400;
export const LABEL_HEIGHT_DOTS = 640;

const TOP_BAND_HEIGHT = 96;    // 12 mm
const MIDDLE_HEIGHT   = 360;   // 45 mm
const BOTTOM_HEIGHT   = 184;   // 23 mm  (96 + 360 + 184 = 640)

export type CupLabelInput = {
  stickerNumber: string;
  cupIdxOf: { idx: number; total: number };
  drinkName: string;
  modifiersText: string;
  doodleSvg: string;
};

export async function renderCupLabelToBitmap(input: CupLabelInput): Promise<Buffer> {
  const top    = await renderTopBand(input);
  const middle = await renderMiddleDoodle(input.doodleSvg);
  const bottom = await renderBottomModifiers(input);

  const composite = await sharp({
    create: {
      width: LABEL_WIDTH_DOTS,
      height: LABEL_HEIGHT_DOTS,
      channels: 1,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      { input: top,    top: 0,                              left: 0 },
      { input: middle, top: TOP_BAND_HEIGHT,                left: 0 },
      { input: bottom, top: TOP_BAND_HEIGHT + MIDDLE_HEIGHT, left: 0 },
    ])
    .threshold(128)
    .raw()
    .toBuffer();

  return packTo1Bit(composite, LABEL_WIDTH_DOTS, LABEL_HEIGHT_DOTS);
}

async function renderTopBand(input: CupLabelInput): Promise<Buffer> {
  const { stickerNumber, cupIdxOf, drinkName } = input;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL_WIDTH_DOTS}" height="${TOP_BAND_HEIGHT}">
    <rect width="100%" height="100%" fill="black"/>
    <text x="12" y="36" font-family="Helvetica,Arial,sans-serif" font-size="32" font-weight="700" fill="white">
      ${escapeXml(stickerNumber)} · ${cupIdxOf.idx}/${cupIdxOf.total}
    </text>
    <text x="12" y="76" font-family="Helvetica,Arial,sans-serif" font-size="28" font-weight="700" fill="white">
      ${escapeXml(drinkName)}
    </text>
  </svg>`;
  return sharp(Buffer.from(svg)).resize(LABEL_WIDTH_DOTS, TOP_BAND_HEIGHT).png().toBuffer();
}

async function renderMiddleDoodle(doodleSvg: string): Promise<Buffer> {
  const png = await renderSvgToPng(doodleSvg, { widthPx: MIDDLE_HEIGHT, heightPx: MIDDLE_HEIGHT });
  // Center on white canvas of label width.
  return sharp({
    create: { width: LABEL_WIDTH_DOTS, height: MIDDLE_HEIGHT, channels: 3, background: "white" },
  })
    .composite([{ input: png, top: 0, left: Math.floor((LABEL_WIDTH_DOTS - MIDDLE_HEIGHT) / 2) }])
    .png()
    .toBuffer();
}

async function renderBottomModifiers(input: CupLabelInput): Promise<Buffer> {
  const wrapped = wrapText(input.modifiersText, 26);
  const lines = wrapped.map(
    (line, i) =>
      `<text x="12" y="${28 + i * 32}" font-family="Helvetica,Arial,sans-serif" font-size="22" fill="black">${escapeXml(line)}</text>`,
  ).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL_WIDTH_DOTS}" height="${BOTTOM_HEIGHT}">
    <rect width="100%" height="100%" fill="white"/>
    ${lines}
  </svg>`;
  return sharp(Buffer.from(svg)).resize(LABEL_WIDTH_DOTS, BOTTOM_HEIGHT).png().toBuffer();
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(" · ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur.length === 0) cur = w;
    else if (cur.length + 3 + w.length <= maxChars) cur += " · " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4); // never overflow band
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
}

function packTo1Bit(grayscale: Buffer, w: number, h: number): Buffer {
  const widthBytes = w / 8;
  if (!Number.isInteger(widthBytes)) throw new Error("width must be multiple of 8");
  const out = Buffer.alloc(widthBytes * h, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = grayscale[y * w + x];
      // After threshold(): 0 = black, 255 = white. Star raster expects 1-bit, 1=fire dot.
      if (px < 128) {
        const byte = y * widthBytes + (x >>> 3);
        out[byte] |= 0x80 >>> (x & 7);
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test, confirm passes**

Run: `npx vitest run src/lib/cup-label/render-tsp100.test.ts`
Expected: PASS — both tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cup-label/render-tsp100.ts src/lib/cup-label/render-tsp100.test.ts
git commit -m "feat(cup-label): TSP100 50x80mm sandwich layout compositor"
```

---

## Task 8: Pre-render default pool script

**Files:**
- Create: `scripts/render-default-pool.ts`

- [ ] **Step 1: Write script**

```ts
// scripts/render-default-pool.ts
// One-off: renders POOL items into full 50x80mm rasters using a sentinel
// drink name + modifiers, uploads to doodles_pool/{key}.bin.
// Re-run any time POOL changes or label layout changes.

import "server-only";
import { POOL } from "../src/lib/doodle/pool";
import { renderCupLabelToBitmap } from "../src/lib/cup-label/render-tsp100";
import { getSupabaseAdmin } from "../src/lib/supabase-server";

async function main() {
  const sb = getSupabaseAdmin();
  for (const item of POOL) {
    const bitmap = await renderCupLabelToBitmap({
      stickerNumber: "OL000",
      cupIdxOf: { idx: 1, total: 1 },
      drinkName: "DOODLE TEMPLATE",
      modifiersText: "(modifiers placeholder)",
      doodleSvg: item.svg,
    });
    const path = `${item.key}.bin`;
    const { error } = await sb.storage
      .from("doodles_pool")
      .upload(path, bitmap, { contentType: "application/octet-stream", upsert: true });
    if (error) throw error;
    console.log(`uploaded doodles_pool/${path} (${bitmap.length} bytes)`);
  }
  console.log("done");
}

main().catch(e => { console.error(e); process.exit(1); });
```

> NOTE: This script renders the **doodle-only** middle band as a standalone artifact for fallback debugging. The actual per-order job re-renders the full label with order-specific top/bottom bands at enqueue time (Task 10). Keeping this script lets ops verify the pool independently.

- [ ] **Step 2: Run script (one-off)**

Run:
```bash
npx tsx scripts/render-default-pool.ts
```
Expected: 4 lines `uploaded doodles_pool/<key>.bin (...)`.

- [ ] **Step 3: Verify in Supabase Storage UI**

Open Supabase dashboard → Storage → `doodles_pool` → confirm 4 `.bin` files exist.

- [ ] **Step 4: Commit**

```bash
git add scripts/render-default-pool.ts
git commit -m "feat(scripts): pre-render default doodle pool to storage"
```

---

## Task 9: enqueueCupLabelJobs (TDD)

**Files:**
- Create: `src/lib/cup-label/enqueue.ts`
- Create: `src/lib/cup-label/enqueue.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/lib/cup-label/enqueue.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Order } from "square";

vi.mock("../supabase-server", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("./render-tsp100", () => ({ renderCupLabelToBitmap: vi.fn(async () => Buffer.from([1, 2, 3])) }));

import { enqueueCupLabelJobs } from "./enqueue";
import { getSupabaseAdmin } from "../supabase-server";

beforeEach(() => vi.clearAllMocks());

describe("enqueueCupLabelJobs", () => {
  it("creates one row per cup, expanding line items by quantity", async () => {
    const inserted: any[] = [];
    const upload = vi.fn(async () => ({ data: { path: "x" }, error: null }));
    (getSupabaseAdmin as any).mockReturnValue({
      from: () => ({ insert: (rows: any[]) => { inserted.push(...rows); return { error: null }; } }),
      storage: { from: () => ({ upload }) },
    });

    const order = {
      id: "ord-1",
      lineItems: [
        { uid: "line-a", quantity: "2", name: "Pearl Milk Tea", modifiers: [{ name: "Pearl" }] },
        { uid: "line-b", quantity: "1", name: "Mango", modifiers: [] },
      ],
    } as unknown as Order;

    await enqueueCupLabelJobs({ order, stickerNumber: "OL100" });

    expect(inserted.length).toBe(3); // 2 + 1
    expect(inserted[0].line_id).toBe("line-a");
    expect(inserted[0].cup_idx).toBe(0);
    expect(inserted[1].cup_idx).toBe(1);
    expect(inserted[2].line_id).toBe("line-b");
    expect(inserted[2].cup_idx).toBe(0);
    expect(inserted.every(r => r.doodle_source === "default")).toBe(true);
    expect(inserted.every(r => typeof r.doodle_pool_key === "string")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, confirm fails**

Run: `npx vitest run src/lib/cup-label/enqueue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/cup-label/enqueue.ts
import "server-only";
import type { Order } from "square";
import { getSupabaseAdmin } from "../supabase-server";
import { pickDefaultForCup } from "../doodle/pool";
import { renderCupLabelToBitmap } from "./render-tsp100";

export type EnqueueCupLabelArgs = {
  order: Order;
  stickerNumber: string;
};

export async function enqueueCupLabelJobs({ order, stickerNumber }: EnqueueCupLabelArgs): Promise<void> {
  const orderId = order.id!;
  const sb = getSupabaseAdmin();
  const lineItems = order.lineItems ?? [];

  type Row = {
    square_order_id: string;
    line_id: string;
    cup_idx: number;
    sticker_number: string;
    drink_name: string;
    modifiers_text: string;
    doodle_source: "default";
    doodle_pool_key: string;
    raster_path: string;
  };

  const rows: Row[] = [];

  for (const line of lineItems) {
    const lineId = line.uid ?? line.catalogObjectId ?? "";
    const qty = Number(line.quantity ?? "1");
    const drinkName = line.name ?? "Drink";
    const modifiersText = (line.modifiers ?? []).map(m => m.name).filter(Boolean).join(" · ") || "—";

    for (let cupIdx = 0; cupIdx < qty; cupIdx++) {
      const pool = pickDefaultForCup(lineId, cupIdx);
      const bitmap = await renderCupLabelToBitmap({
        stickerNumber,
        cupIdxOf: { idx: cupIdx + 1, total: qty },
        drinkName,
        modifiersText,
        doodleSvg: pool.svg,
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
        doodle_source: "default",
        doodle_pool_key: pool.key,
        raster_path: rasterPath,
      });
    }
  }

  if (rows.length === 0) return;
  const { error: insErr } = await sb.from("cup_label_jobs").insert(rows);
  if (insErr) throw insErr;
}
```

- [ ] **Step 4: Run test, confirm passes**

Run: `npx vitest run src/lib/cup-label/enqueue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cup-label/enqueue.ts src/lib/cup-label/enqueue.test.ts
git commit -m "feat(cup-label): enqueue per-cup CloudPRNT jobs with default doodles"
```

---

## Task 10: CloudPRNT poll endpoint

**Files:**
- Create: `src/app/api/cloudprnt/poll/route.ts`

> NOTE on Next.js: AGENTS.md warns the Next runtime here may differ from your training data. Before writing this route, read `node_modules/next/dist/docs/` (look for "Route Handlers" / "Runtime") to confirm:
> - the correct way to set `runtime = "nodejs"` (sharp + Buffer require Node, not edge)
> - the correct way to return raw `Buffer` with custom Content-Type
> - whether response streaming has any new conventions

- [ ] **Step 1: Implement**

```ts
// src/app/api/cloudprnt/poll/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { buildLabelJob } from "@/lib/star/raster";
import { LABEL_WIDTH_DOTS, LABEL_HEIGHT_DOTS } from "@/lib/cup-label/render-tsp100";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WIDTH_BYTES = LABEL_WIDTH_DOTS / 8;

export async function POST() {
  const sb = getSupabaseAdmin();

  // Atomically claim the oldest pending job.
  const { data: claimed, error: claimErr } = await sb.rpc("claim_oldest_cup_label_job");
  if (claimErr) {
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ jobReady: false });
  }
  const job = claimed[0] as { id: string; raster_path: string; printer_token: string };

  const { data: file, error: dlErr } = await sb.storage.from("doodles").download(job.raster_path);
  if (dlErr || !file) {
    await markFailed(job.id, dlErr?.message ?? "download failed");
    return NextResponse.json({ jobReady: false });
  }

  const bitmap = Buffer.from(await file.arrayBuffer());
  const stream = buildLabelJob(bitmap, WIDTH_BYTES, LABEL_HEIGHT_DOTS);

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.star.starprnt",
      "X-Star-Job-Token": job.printer_token,
    },
  });

  async function markFailed(id: string, err: string) {
    await sb
      .from("cup_label_jobs")
      .update({ status: "failed", last_error: err })
      .eq("id", id);
  }
}

// GET also supported by some Star firmware variants — return the same poll behaviour.
export const GET = POST;
```

- [ ] **Step 2: Add the supporting RPC migration**

Create: `supabase/migrations/2026-04-27-claim-cup-label-job.sql`

```sql
create or replace function claim_oldest_cup_label_job()
returns table (id uuid, raster_path text, printer_token text)
language plpgsql
as $$
declare
  token text := gen_random_uuid()::text;
begin
  return query
  with nxt as (
    select j.id from cup_label_jobs j
     where j.status = 'pending'
     order by j.created_at
     for update skip locked
     limit 1
  )
  update cup_label_jobs j
     set status = 'printing',
         attempts = j.attempts + 1,
         printer_token = token
   from nxt
   where j.id = nxt.id
   returning j.id, j.raster_path, j.printer_token;
end;
$$;
```

Apply:
```bash
npx supabase db push
```

- [ ] **Step 3: Smoke test the route locally**

Run dev server, then:
```bash
curl -X POST http://localhost:3000/api/cloudprnt/poll -i | head -20
```
Expected (no jobs queued): `HTTP/1.1 200`, body `{"jobReady":false}`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cloudprnt/poll/route.ts supabase/migrations/2026-04-27-claim-cup-label-job.sql
git commit -m "feat(api): CloudPRNT poll endpoint with atomic job claim"
```

---

## Task 11: CloudPRNT ack endpoint

**Files:**
- Create: `src/app/api/cloudprnt/ack/route.ts`

- [ ] **Step 1: Implement**

```ts
// src/app/api/cloudprnt/ack/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 3;

export async function POST(req: NextRequest) {
  let body: { jobToken?: string; status?: string; code?: string };
  try { body = await req.json(); } catch { body = {}; }

  const token = body.jobToken;
  if (!token) return NextResponse.json({ error: "missing jobToken" }, { status: 400 });

  const sb = getSupabaseAdmin();
  const { data: row } = await sb
    .from("cup_label_jobs")
    .select("id, attempts")
    .eq("printer_token", token)
    .maybeSingle();

  if (!row) return NextResponse.json({ ok: true }); // unknown token, no-op

  if (body.status === "ok") {
    await sb
      .from("cup_label_jobs")
      .update({ status: "printed", printed_at: new Date().toISOString() })
      .eq("id", row.id);
  } else {
    const finalStatus = (row.attempts ?? 0) >= MAX_ATTEMPTS ? "failed" : "pending";
    await sb
      .from("cup_label_jobs")
      .update({
        status: finalStatus,
        printer_token: null,
        last_error: body.code ?? body.status ?? "error",
      })
      .eq("id", row.id);
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Smoke test**

```bash
curl -X POST http://localhost:3000/api/cloudprnt/ack \
  -H 'Content-Type: application/json' \
  -d '{"jobToken":"nope","status":"ok"}'
```
Expected: `{"ok":true}` HTTP 200.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cloudprnt/ack/route.ts
git commit -m "feat(api): CloudPRNT ack endpoint with retry + max-attempts"
```

---

## Task 12: Wire enqueueCupLabelJobs into order creation (parallel write)

**Files:**
- Modify: `src/lib/print-jobs.ts` (find existing `enqueuePrintJob` call site or its return point — see Step 1)

> **CRITICAL:** This task adds a SIDE-BY-SIDE call. Existing `enqueuePrintJob` MUST keep running unchanged. Errors from the new path MUST NOT block the old path.

- [ ] **Step 1: Locate the existing call site**

Run:
```bash
npx grep -rn "enqueuePrintJob" src/
```

Identify where `enqueuePrintJob` is **called** (likely in `/api/payment/route.ts` or `/api/orders/route.ts`). Read 30 lines around the call.

- [ ] **Step 2: Add side-by-side call after the existing one**

At each `await enqueuePrintJob(...)` call site, add right after:

```ts
// CloudPRNT (TSP100) parallel path — non-blocking, must never break the legacy print_jobs flow.
try {
  const { enqueueCupLabelJobs } = await import("@/lib/cup-label/enqueue");
  const stickerNumber = /* derive from existing print_jobs row, or recompute */;
  await enqueueCupLabelJobs({ order, stickerNumber });
} catch (e) {
  console.error("[cup-label] enqueue failed (non-fatal)", e);
}
```

> NOTE: `stickerNumber` derivation: if `enqueuePrintJob` already returns it, use that. Otherwise re-read the freshly inserted print_jobs row by `square_order_id` and reuse `sticker_number`. Do NOT compute a new one — both paths must share the same OL number.

- [ ] **Step 3: Manual end-to-end test in dev**

1. Run dev server.
2. Place a test order through the UI as you normally would.
3. Check Supabase:
   ```sql
   select id, sticker_number, drink_name, status from cup_label_jobs order by created_at desc limit 5;
   ```
   Expected: N rows where N = total cups in the order.
4. Check the original `print_jobs` table is **unchanged** in behaviour:
   ```sql
   select id, sticker_number, status from print_jobs order by created_at desc limit 5;
   ```
   Expected: 1 new row, same sticker_number as cup_label_jobs above.

- [ ] **Step 4: Commit**

```bash
git add src/lib/print-jobs.ts # or whichever file you touched
git commit -m "feat(cup-label): write to cup_label_jobs in parallel with print_jobs"
```

---

## Task 13: Admin manual test-print endpoint

**Files:**
- Create: `src/app/api/admin/cup-label/test-print/route.ts`

- [ ] **Step 1: Implement**

```ts
// src/app/api/admin/cup-label/test-print/route.ts
// Forces a single test cup_label_jobs row so the printer pulls it on next poll.
// Use this BEFORE wiring real orders end-to-end (Task 12) to verify hardware.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { renderCupLabelToBitmap } from "@/lib/cup-label/render-tsp100";
import { POOL } from "@/lib/doodle/pool";
import { requireAdmin } from "@/lib/admin-auth"; // existing admin gate — confirm path matches your repo

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  await requireAdmin(req);

  const { drinkName = "TEST DRINK", modifiersText = "TEST · M", poolKey = "bunny" } = await req.json().catch(() => ({}));
  const item = POOL.find(p => p.key === poolKey) ?? POOL[0];

  const bitmap = await renderCupLabelToBitmap({
    stickerNumber: "TEST",
    cupIdxOf: { idx: 1, total: 1 },
    drinkName,
    modifiersText,
    doodleSvg: item.svg,
  });

  const sb = getSupabaseAdmin();
  const orderId = `test-${Date.now()}`;
  const path = `${orderId}/test_0.bin`;
  await sb.storage.from("doodles").upload(path, bitmap, { contentType: "application/octet-stream" });

  const { data, error } = await sb
    .from("cup_label_jobs")
    .insert({
      square_order_id: orderId,
      line_id: "test-line",
      cup_idx: 0,
      sticker_number: "TEST",
      drink_name: drinkName,
      modifiers_text: modifiersText,
      doodle_source: "default",
      doodle_pool_key: item.key,
      raster_path: path,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, jobId: data.id });
}
```

> NOTE: If `requireAdmin` does not exist in this codebase, mirror whichever admin gate `/admin/prints` uses. Do NOT leave this endpoint unauthenticated.

- [ ] **Step 2: Manual smoke test**

```bash
curl -X POST http://localhost:3000/api/admin/cup-label/test-print \
  -H 'Cookie: <admin session cookie>' \
  -H 'Content-Type: application/json' \
  -d '{"drinkName":"Pearl MT","modifiersText":"L · Pearl×2"}'
```
Expected: `{"ok":true,"jobId":"..."}`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/cup-label/test-print/route.ts
git commit -m "feat(api): admin endpoint to manually enqueue a TSP100 test print"
```

---

## Task 14: Hardware setup runbook

**Files:**
- Create: `docs/operations/tsp100-setup.md`

- [ ] **Step 1: Write runbook**

```markdown
# Star TSP100IV SK Setup (CloudPRNT mode)

## One-time procedure

### 1. Unbox & paper
- Remove tape, plug power.
- Load the 50×80mm three-proof die-cut roll.
- Hold FEED ~3s on power-on → printer auto-calibrates the gap sensor.
  Verify: it should advance exactly to the next gap, not run continuously.

### 2. Network
- Connect via USB to a laptop **OR** join temporary AP `Star_PRNT-XXXX`.
- Open `http://<printer-ip>` in a browser.
- WiFi → join store WiFi (5 GHz preferred).
- Note the IP that the printer takes.

### 3. CloudPRNT
- Open the printer admin page → CloudPRNT.
- Server URL: `https://mandybubbletea.com/api/cloudprnt/poll`
- Polling interval: 5 seconds
- Encryption: TLS on
- Save → reboot.

### 4. Verify
- POST a test job:
  ```bash
  curl -X POST https://mandybubbletea.com/api/admin/cup-label/test-print \
       -H 'Cookie: <owner cookie>' \
       -H 'Content-Type: application/json' \
       -d '{}'
  ```
- A label should print within 10 seconds (poll interval + render).
- Ack should land — verify in Supabase:
  ```sql
  select id, status, printed_at from cup_label_jobs order by created_at desc limit 1;
  ```
  Status should be `printed`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Continuous paper feed | Gap sensor not seeing die-cut | Re-calibrate (hold FEED on power-on) |
| Polls but never prints | TLS/HTTPS rejected | Confirm cert valid; printer firmware up to date |
| Prints but `status` stays `printing` | Ack not reaching us | Check printer logs; URL for ack is set |
| Label shifted up/down | Gap calibration drift | Re-feed and recalibrate |
```

- [ ] **Step 2: Commit**

```bash
git add docs/operations/tsp100-setup.md
git commit -m "docs(ops): TSP100IV SK CloudPRNT setup runbook"
```

---

## Task 15: 1-week parallel-run verification checklist

> This is **execution**, not code. Do these BEFORE proceeding to Phase 2.

- [ ] **Day 0** — Hardware setup per Task 14. First test print succeeds.
- [ ] **Day 1** — First real paid orders: TSP100 prints alongside ZD411. Compare visually.
- [ ] **Day 1-7** — Each day:
  - [ ] Check `select count(*), status from cup_label_jobs group by status;` — confirm no `failed` accumulating.
  - [ ] Check `select count(*) from cup_label_jobs where status='printing' and created_at < now() - interval '1 minute';` — should be 0 (means stuck jobs).
  - [ ] Spot-check 3 labels for layout, dot density, sticker number alignment with ZD411.
- [ ] **Day 7 review** — If all clean, mark Phase 1 done and start Phase 2 plan. If issues, file them and stay on parallel run until fixed.

---

## Self-Review Notes

**Spec coverage**: All Phase 1 items from spec §7 阶段 1 mapped to tasks 2-14. Task 15 covers the "1 week parallel run" item. The "新订单服务端自动给每杯分配默认图——无 app UI" requirement is task 12.

**Out of scope (Phase 2/3)**:
- App UI for user doodling
- `/api/doodle/upload` (user paths) — only default-pool render path here
- Vercel Cron 24h cleanup
- ZD411 retirement
- App OTA / RN changes

**Known placeholder**: SVG default art is generic geometric shapes. Spec §1 Q10 says "use existing Mandy IP, designer upgrade deferred" — replacing the four POOL entries with sourced art is a content task that does not require code changes (re-run Task 8 script after edits).
