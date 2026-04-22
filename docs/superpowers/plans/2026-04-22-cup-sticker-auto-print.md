# Cup Sticker Auto-Print Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-print a 50×30 mm English cup sticker on an in-store Zebra ZD411 the moment any Square order (web or POS) is paid, with a reliable retry/replay/alert path so the shop never silently loses a print.

**Architecture:** Extend the existing Vercel Square webhook (`src/app/api/webhooks/square/route.ts`) to enqueue paid orders into a new Supabase `print_jobs` table. A new local Node service (`printer-client/`) on a store Mac mini subscribes to Supabase Realtime, renders ZPL, and sends jobs to Zebra via CUPS (`lp -o raw`). Two operational UIs sit on top: `localhost:3001` for employees, `mandybubbletea.com/admin/prints` for the owner. Alerts flow from Mac mini → a new Vercel endpoint → Expo push.

**Tech Stack:** Next.js 16 + Supabase (`@supabase/supabase-js` v2, Realtime via `postgres_changes`), Square SDK v44 (`orders.get`, `WebhooksHelper`), Node 20 + Express on the Mac mini, CUPS (`lp`) for USB printing, `vitest` for pure-function tests, `launchd` for service supervision, `expo-server-sdk` (already installed) for alert fan-out.

**Related design doc:** `docs/superpowers/specs/2026-04-22-cup-sticker-print-design.md`

---

## File Structure

### Main project (`~/Github/mandys_bubble_tea`)
- **Create** `supabase/migrations/2026-04-22-print-jobs.sql` — tables + `next_store_order_number()` RPC
- **Create** `src/lib/sticker-number.ts` — `encodeStoreStickerNumber(n)` (TA compression)
- **Create** `src/lib/sticker-number.test.ts` — table-driven encoder tests
- **Create** `src/lib/modifier-buckets.ts` — map `modifierListId → 'topping'|'ice'|'sugar'`
- **Create** `src/lib/modifier-buckets.test.ts` — resolver tests
- **Create** `src/lib/print-jobs.ts` — `enqueuePrintJob(order)` (server-only)
- **Modify** `src/app/api/webhooks/square/route.ts` — add `order.updated` paid-order branch
- **Create** `src/app/api/admin/print-alert/route.ts` — receives Mac mini alerts, fans out Expo push
- **Create** `src/app/api/admin/prints/reprint/route.ts` — clones a print_job row (authed)
- **Create** `src/app/admin/layout.tsx` — admin auth gate
- **Create** `src/app/admin/prints/page.tsx` — queue view + reprint
- **Create** `vitest.config.ts` — test runner config
- **Modify** `package.json` — add `vitest` dev dep + `test` script
- **Modify** `.vercelignore` — exclude `printer-client/` from Vercel deploys

### Printer client (`~/Github/mandys_bubble_tea/printer-client/`)
- **Create** `printer-client/package.json`
- **Create** `printer-client/tsconfig.json`
- **Create** `printer-client/.env.local.example`
- **Create** `printer-client/README.md`
- **Create** `printer-client/src/config.ts` — env var loader
- **Create** `printer-client/src/supabase.ts` — service-role client
- **Create** `printer-client/src/printer.ts` — `printZPL(zpl)` via `lp -o raw`
- **Create** `printer-client/src/zpl.ts` — `renderStickerZPL(cup)`
- **Create** `printer-client/src/zpl.test.ts` — ZPL snapshot-ish tests
- **Create** `printer-client/src/queue.ts` — Realtime subscriber + `handleJob` + `replayOnStart`
- **Create** `printer-client/src/alert.ts` — POST to `/api/admin/print-alert`
- **Create** `printer-client/src/heartbeat.ts` — `upsertPrinterHeartbeat()` every 30 s
- **Create** `printer-client/src/ui/server.ts` — Express routes
- **Create** `printer-client/src/ui/public/index.html`
- **Create** `printer-client/src/ui/public/app.js`
- **Create** `printer-client/src/index.ts` — entry point, wires everything
- **Create** `printer-client/scripts/test-print.ts` — fires a canned ZPL for smoke test
- **Create** `printer-client/scripts/seed-fake-job.ts` — INSERT a test print_jobs row
- **Create** `printer-client/launchd/com.mandysbubbletea.printer.plist`

### Ops / dashboards
- Square Dashboard → subscribe webhook to `order.updated`
- Supabase SQL editor → apply migration + seed `admin_users`
- Vercel env → add `PRINTER_ALERT_TOKEN`
- Mac mini → add Zebra via System Settings → Printers, install launchd agent

---

## Context notes for the engineer

### Square order shape on `order.updated`

The webhook body is the same event envelope used for `order.fulfillment.updated` (see the existing handler at `src/app/api/webhooks/square/route.ts:29-50`), but `data.object.order_updated` is the branch:

```json
{
  "type": "order.updated",
  "event_id": "...",
  "data": {
    "type": "order_updated",
    "id": "<order_id>",
    "object": {
      "order_updated": {
        "order_id": "<order_id>",
        "version": 5,
        "location_id": "...",
        "state": "OPEN",
        "updated_at": "2026-04-22T21:35:00Z"
      }
    }
  }
}
```

The event carries no tenders. The handler MUST call `squareClient.orders.get({ orderId })` to inspect `response.order.tenders`, `totalMoney`, `lineItems`, `metadata`, and `ticketName`.

### Paid-order detection

- `response.order.tenders` is a non-empty array with at least one tender whose `type` is `CARD` or `CASH` or `WALLET` etc. Any non-empty tenders array counts as "paid" — Square only appends tenders after charge success.
- `response.order.totalMoney.amount > 0n` (amount is a bigint from Square SDK).
- We do not check `state` since `OPEN` is the default operating state even for fully paid orders at our pickup flow.

### Source detection

- **Web**: `response.order.metadata.source === 'web'` (set in `src/app/api/orders/route.ts:225`). The sticker number is `response.order.ticketName` as-is (already `OL800+`).
- **POS**: anything else. Get a new number from the `next_store_order_number()` RPC and encode via `encodeStoreStickerNumber(n)`.

### Why `unique(square_order_id)` replaces manual dedup

Square retries webhooks on non-2xx, and `order.updated` fires many times across an order's lifecycle. The existing push-notification path uses a separate `claimOrderPushSlot` helper. This plan intentionally skips that pattern: the `unique(square_order_id)` constraint on `print_jobs` plus `ON CONFLICT DO NOTHING` is simpler and sufficient. First INSERT wins; every later attempt silently no-ops. The handler still has to gate on `tenders.length > 0 && totalMoney > 0` before attempting INSERT so `order.updated` events that predate the payment don't race the table with a paid one.

### Modifier list IDs

Each Square modifier list (e.g. "Topping List", "Ice Level", "Sugar Level") has a stable `id` in the Square Catalog. Read them once from the Dashboard and hard-code into `modifier-buckets.ts`. Adding a new modifier list in Square Dashboard later requires updating this file — documented in `printer-client/README.md` and in a comment at the top of `modifier-buckets.ts`.

### CUPS vs node-usb

We use CUPS (`lp -d Zebra_ZD411 -o raw` piping ZPL to stdin) rather than `node-usb`. CUPS integrates with macOS Printer Preferences, survives user logout, and exposes `lpstat -p Zebra_ZD411` for status. `node-usb` requires disabling the default CUPS claim on the USB endpoint, which is fragile across macOS updates. One-time setup: add the Zebra ZD411 in **System Settings → Printers & Scanners** (macOS recognises it as a generic USB printer; pick the "Generic Thermal" or "Zebra ZPL" driver).

### Vercel excluding `printer-client/`

Vercel auto-detects Node apps; we do NOT want `printer-client/` built/deployed to Vercel. Add to `.vercelignore`. The main `next build` in the repo root ignores anything outside `src/`, so no further changes are needed.

### Supabase Realtime: `postgres_changes` on `print_jobs`

Realtime requires the table to have `REPLICA IDENTITY FULL` (or default) and be listed in the realtime publication. Both are handled by a `alter publication` line in the migration. Without it, Mac mini never receives events.

---

## Phase 0 — Test runner setup

### Task 0.1: Install vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install vitest as a dev dependency**

```bash
cd ~/Github/mandys_bubble_tea
npm install --save-dev vitest
```

- [ ] **Step 2: Add test script to `package.json`**

In `package.json`, inside the `"scripts"` object, add `"test": "vitest run"` and `"test:watch": "vitest"` alongside the existing scripts.

Expected end state of the scripts block:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest",
  "postinstall": "patch-package"
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts", "printer-client/src/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Verify vitest runs (expect no tests found)**

```bash
npm test
```

Expected: `No test files found` (not an error — confirms vitest is wired).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore(tests): add vitest for pure-function tests"
```

---

## Phase 1 — Database migration

### Task 1.1: Write the migration file

**Files:**
- Create: `supabase/migrations/2026-04-22-print-jobs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Cup-sticker auto-print tables + counters.
-- See docs/superpowers/specs/2026-04-22-cup-sticker-print-design.md

-- ---------- print_jobs ----------
-- One row per Square order (web or POS). unique(square_order_id) is the
-- dedup mechanism; the Vercel webhook INSERTs with ON CONFLICT DO NOTHING
-- so redelivery and repeated order.updated events are safe.
create table if not exists print_jobs (
  id                uuid primary key default gen_random_uuid(),
  square_order_id   text not null unique,
  source            text not null check (source in ('web', 'pos')),
  sticker_number    text not null,
  order_total_cents integer not null,
  cups              jsonb not null,
  status            text not null default 'pending'
                     check (status in ('pending', 'printed', 'failed', 'stale')),
  attempts          integer not null default 0,
  last_error        text,
  created_at        timestamptz not null default now(),
  printed_at        timestamptz
);

create index if not exists print_jobs_status_created_idx
  on print_jobs (status, created_at);

-- Expose to Realtime (postgres_changes on INSERT).
alter publication supabase_realtime add table print_jobs;

-- ---------- store_order_counters ----------
-- Daily counter for TA numbering. Keyed by local day in Australia/Brisbane.
create table if not exists store_order_counters (
  day    date primary key,
  last_n integer not null default 0
);

create or replace function next_store_order_number()
returns integer
language plpgsql
as $$
declare
  today date := (current_timestamp at time zone 'Australia/Brisbane')::date;
  v int;
begin
  insert into store_order_counters (day) values (today)
    on conflict (day) do nothing;
  update store_order_counters
    set last_n = last_n + 1
    where day = today
    returning last_n into v;
  return v;
end;
$$;

-- ---------- printer_heartbeats ----------
-- Mac mini upserts every 30s. /admin/prints reads this to show health.
create table if not exists printer_heartbeats (
  device_id      text primary key,
  last_seen_at   timestamptz not null,
  printer_status text,
  pending_count  integer
);

-- ---------- admin_users ----------
-- Owner allow-list for /admin/prints. Seeded manually.
create table if not exists admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role    text not null check (role in ('owner'))
);

-- ---------- RLS ----------
-- print_jobs: service-role (Vercel + Mac mini) writes; admin owners read via
-- SSR server components using service-role — no RLS policies needed here,
-- but we enable RLS as a defence-in-depth measure.
alter table print_jobs enable row level security;
alter table printer_heartbeats enable row level security;
alter table admin_users enable row level security;
-- (No policies added; service-role bypasses RLS. Any future anon/authed
-- client that needs read access must have a policy added explicitly.)
```

- [ ] **Step 2: Commit the migration**

```bash
cd ~/Github/mandys_bubble_tea
git add supabase/migrations/2026-04-22-print-jobs.sql
git commit -m "feat(db): print_jobs + store_order_counters + printer_heartbeats + admin_users"
```

### Task 1.2: Apply migration to hosted Supabase

- [ ] **Step 1: Open the Supabase SQL editor for the production project**

Go to https://supabase.com/dashboard/project/<PROJECT_REF>/sql/new

- [ ] **Step 2: Paste the migration and run**

Paste the full contents of `supabase/migrations/2026-04-22-print-jobs.sql`. Click **Run**.
Expected: `Success. No rows returned.`

- [ ] **Step 3: Verify tables and function exist**

In a fresh SQL editor window:
```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('print_jobs', 'store_order_counters', 'printer_heartbeats', 'admin_users');

select proname from pg_proc where proname = 'next_store_order_number';

select schemaname, tablename from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'print_jobs';
```
Expected: 4 rows, 1 row, 1 row respectively.

### Task 1.3: Seed the owner's admin_users row

- [ ] **Step 1: Find the owner's user_id**

In Supabase SQL editor:
```sql
select id, email from auth.users where email = '<owner email>';
```
Copy the `id` (uuid).

- [ ] **Step 2: Insert the admin row**

```sql
insert into admin_users (user_id, role) values ('<paste-uuid>', 'owner');
```
Expected: `INSERT 0 1`.

- [ ] **Step 3: Verify**

```sql
select * from admin_users;
```
Expected: one row with role `owner`.

---

## Phase 2 — Shared libraries (main project)

### Task 2.1: Sticker number encoder + tests

**Files:**
- Create: `src/lib/sticker-number.ts`
- Create: `src/lib/sticker-number.test.ts`

- [ ] **Step 1: Write the encoder**

```ts
// src/lib/sticker-number.ts

/**
 * Encode an in-store daily counter value into the compact TA sticker format.
 *
 *   - core: `TA` + (n % 100), zero-padded to 2 digits
 *   - `$` appended for each 1000: floor(n / 1000)
 *   - `*` appended for each 100 within the current thousand: floor((n % 1000) / 100)
 *   - `$`s precede `*`s (larger place first, reads naturally)
 *
 *   47   -> 'TA47'
 *   147  -> 'TA47*'
 *   947  -> 'TA47*********'    (9 stars)
 *   1047 -> 'TA47$'
 *   1247 -> 'TA47$**'
 *   2347 -> 'TA47$$***'
 */
export function encodeStoreStickerNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`encodeStoreStickerNumber: n must be a non-negative integer (got ${n})`);
  }
  const base = String(n % 100).padStart(2, "0");
  const hundreds = Math.floor((n % 1000) / 100);
  const thousands = Math.floor(n / 1000);
  return `TA${base}${"$".repeat(thousands)}${"*".repeat(hundreds)}`;
}
```

- [ ] **Step 2: Write the table-driven test**

```ts
// src/lib/sticker-number.test.ts
import { describe, it, expect } from "vitest";
import { encodeStoreStickerNumber } from "./sticker-number";

describe("encodeStoreStickerNumber", () => {
  const cases: Array<[number, string]> = [
    [0, "TA00"],
    [1, "TA01"],
    [9, "TA09"],
    [47, "TA47"],
    [99, "TA99"],
    [100, "TA00*"],
    [147, "TA47*"],
    [199, "TA99*"],
    [200, "TA00**"],
    [900, "TA00*********"],
    [947, "TA47*********"],
    [999, "TA99*********"],
    [1000, "TA00$"],
    [1047, "TA47$"],
    [1100, "TA00$*"],
    [1247, "TA47$**"],
    [1999, "TA99$*********"],
    [2000, "TA00$$"],
    [2347, "TA47$$***"],
    [9999, "TA99$$$$$$$$$*********"],
  ];
  for (const [n, expected] of cases) {
    it(`encodes ${n} -> ${expected}`, () => {
      expect(encodeStoreStickerNumber(n)).toBe(expected);
    });
  }
  it("rejects negative input", () => {
    expect(() => encodeStoreStickerNumber(-1)).toThrow();
  });
  it("rejects non-integer input", () => {
    expect(() => encodeStoreStickerNumber(1.5)).toThrow();
  });
});
```

- [ ] **Step 3: Run the test**

```bash
npm test
```
Expected: all 22 cases pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/sticker-number.ts src/lib/sticker-number.test.ts
git commit -m "feat(sticker): TA compact order number encoder"
```

### Task 2.2: Modifier bucket resolver + tests

**Files:**
- Create: `src/lib/modifier-buckets.ts`
- Create: `src/lib/modifier-buckets.test.ts`

- [ ] **Step 1: Look up Square modifier list IDs**

In the Square Dashboard, go to **Items & orders → Modifiers**. For each modifier list ("Topping List", "Ice Level", "Sugar Level"), click to view its detail page. The URL contains the id (`...modifier-lists/<MODIFIER_LIST_ID>`). Copy each id.

(If you don't have Dashboard access yet, use placeholder ids and file a follow-up to update before go-live. Leave a `TODO(pre-launch):` comment next to each.)

- [ ] **Step 2: Write the resolver**

```ts
// src/lib/modifier-buckets.ts

// Maps Square modifier list ids to our logical buckets. Used at webhook
// time to sort a line item's modifiers into topping/ice/sugar slots for
// the sticker. Unknown modifier lists fall through to the topping bucket
// (safe default: shows up on the sticker rather than being dropped).
//
// To add a new modifier list (e.g. "Seasonal Flavour"):
//   1. Find its id in Square Dashboard (Items & orders -> Modifiers).
//   2. Decide which bucket it belongs to.
//   3. Add an entry below.

export type ModifierBucket = "topping" | "ice" | "sugar";

export const MODIFIER_LIST_BUCKETS: Record<string, ModifierBucket> = {
  // TODO(pre-launch): replace these ids with the real ones from Square Dashboard.
  "REPLACE_ME_TOPPING_LIST_ID": "topping",
  "REPLACE_ME_ICE_LEVEL_LIST_ID": "ice",
  "REPLACE_ME_SUGAR_LEVEL_LIST_ID": "sugar",
};

export function bucketForModifierList(modifierListId: string | undefined | null): ModifierBucket {
  if (!modifierListId) return "topping";
  return MODIFIER_LIST_BUCKETS[modifierListId] ?? "topping";
}
```

- [ ] **Step 3: Write the test**

```ts
// src/lib/modifier-buckets.test.ts
import { describe, it, expect } from "vitest";
import {
  bucketForModifierList,
  MODIFIER_LIST_BUCKETS,
} from "./modifier-buckets";

describe("bucketForModifierList", () => {
  it("returns the mapped bucket for every entry in MODIFIER_LIST_BUCKETS", () => {
    for (const [id, bucket] of Object.entries(MODIFIER_LIST_BUCKETS)) {
      expect(bucketForModifierList(id)).toBe(bucket);
    }
  });
  it("falls back to topping for unknown list ids", () => {
    expect(bucketForModifierList("unknown-list-xyz")).toBe("topping");
  });
  it("falls back to topping for null/undefined", () => {
    expect(bucketForModifierList(null)).toBe("topping");
    expect(bucketForModifierList(undefined)).toBe("topping");
  });
});
```

- [ ] **Step 4: Run the tests**

```bash
npm test
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/modifier-buckets.ts src/lib/modifier-buckets.test.ts
git commit -m "feat(sticker): modifier list id -> topping/ice/sugar bucket resolver"
```

### Task 2.3: print_jobs enqueue helper

**Files:**
- Create: `src/lib/print-jobs.ts`

- [ ] **Step 1: Write the helper**

```ts
// src/lib/print-jobs.ts
import "server-only";
import type { Order, OrderLineItem, OrderLineItemModifier } from "square";
import { getSupabaseAdmin } from "./supabase-server";
import { encodeStoreStickerNumber } from "./sticker-number";
import type { ModifierBucket } from "./modifier-buckets";

type CupRow = {
  drinkName: string;
  toppings: string[];
  ice: string | null;
  sugar: string | null;
  priceCents: number;
};

type EnqueueArgs = {
  order: Order;
};

export async function enqueuePrintJob({ order }: EnqueueArgs): Promise<
  | { queued: true; stickerNumber: string }
  | { queued: false; reason: "not_paid" | "no_line_items" | "conflict" | "error"; detail?: string }
> {
  // Gate: must be paid.
  const tenders = order.tenders ?? [];
  const totalCents = order.totalMoney?.amount ?? 0n;
  if (tenders.length === 0 || totalCents <= 0n) {
    return { queued: false, reason: "not_paid" };
  }
  const lineItems = order.lineItems ?? [];
  if (lineItems.length === 0) {
    return { queued: false, reason: "no_line_items" };
  }

  const source: "web" | "pos" = order.metadata?.source === "web" ? "web" : "pos";

  // Sticker number.
  let stickerNumber: string;
  const admin = getSupabaseAdmin();
  if (source === "web") {
    if (!order.ticketName) {
      return { queued: false, reason: "error", detail: "web order missing ticketName" };
    }
    stickerNumber = order.ticketName;
  } else {
    const { data, error } = await admin.rpc("next_store_order_number");
    if (error) {
      return { queued: false, reason: "error", detail: `counter rpc failed: ${error.message}` };
    }
    stickerNumber = encodeStoreStickerNumber(Number(data));
  }

  // Expand lineItems into cups.
  const cups: CupRow[] = [];
  for (const line of lineItems) {
    const q = Number(line.quantity ?? "1");
    const cup = cupFromLineItem(line);
    for (let i = 0; i < q; i++) cups.push(cup);
  }

  const { error: insertError } = await admin.from("print_jobs").insert(
    {
      square_order_id: order.id!,
      source,
      sticker_number: stickerNumber,
      order_total_cents: Number(totalCents),
      cups,
      status: "pending",
    },
    { count: "exact" },
  );
  if (insertError) {
    // Unique-violation on square_order_id = already queued; silent skip.
    if (insertError.code === "23505") {
      return { queued: false, reason: "conflict" };
    }
    return { queued: false, reason: "error", detail: insertError.message };
  }
  return { queued: true, stickerNumber };
}

function cupFromLineItem(line: OrderLineItem): CupRow {
  const toppings: string[] = [];
  let ice: string | null = null;
  let sugar: string | null = null;

  // Square does NOT include the modifier list id on the line-item
  // modifier payload, so we classify by name. MODIFIER_LIST_BUCKETS +
  // bucketForModifierList() exist in modifier-buckets.ts for a future
  // catalog-lookup path that would resolve the list id; for the MVP
  // name matching is sufficient.
  for (const m of line.modifiers ?? []) {
    const bucket = matchModifierByName(m.name ?? "");
    placeInBucket(bucket, m, toppings, (v) => (ice = v), (v) => (sugar = v));
  }

  // Unit price = base variation price + sum of modifier upcharges.
  const basePrice = Number(line.basePriceMoney?.amount ?? 0n);
  const modPrice = (line.modifiers ?? []).reduce((s: number, m: OrderLineItemModifier) => {
    return s + Number(m.basePriceMoney?.amount ?? 0n);
  }, 0);
  const priceCents = basePrice + modPrice;

  return {
    drinkName: line.name ?? "Drink",
    toppings,
    ice,
    sugar,
    priceCents,
  };
}

function placeInBucket(
  bucket: ModifierBucket,
  m: OrderLineItemModifier,
  toppings: string[],
  setIce: (v: string) => void,
  setSugar: (v: string) => void,
): void {
  const name = m.name ?? "";
  if (bucket === "topping") toppings.push(name);
  else if (bucket === "ice") setIce(name);
  else if (bucket === "sugar") setSugar(name);
}

// Fallback: classify a modifier by its name if the modifier list id isn't
// available on the payload. Case-insensitive substring match against known
// patterns; anything else lands in "topping" as a safe default.
function matchModifierByName(name: string): ModifierBucket {
  const n = name.toLowerCase();
  if (n.includes("sugar")) return "sugar";
  if (n.includes("ice")) return "ice";
  return "topping";
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/print-jobs.ts
git commit -m "feat(sticker): enqueuePrintJob helper (tenders gate + cup expansion)"
```

---

## Phase 3 — Webhook extension

### Task 3.1: Extend the Square webhook handler

**Files:**
- Modify: `src/app/api/webhooks/square/route.ts`

- [ ] **Step 1: Add the new branch helper**

Open `src/app/api/webhooks/square/route.ts`. Near the top (after the other `pick*` helpers ~line 60-73) add:

```ts
/**
 * Returns the order_id on an order.updated event, regardless of state.
 * The caller will gate on payment presence after fetching the full order.
 */
function pickUpdatedOrderId(event: SquareEvent): string | null {
  const payload = event.data?.object?.order_updated;
  if (!payload) return null;
  return payload.order_id ?? null;
}
```

Update the `SquareEvent` type (~line 35-50) to include `order_updated`:

```ts
type SquareEvent = {
  type?: string;
  event_id?: string;
  data?: {
    id?: string;
    type?: string;
    object?: {
      customer?: { id?: string };
      order_fulfillment_updated?: {
        order_id?: string;
        state?: string;
        fulfillment_update?: SquareFulfillmentUpdate[];
      };
      order_updated?: {
        order_id?: string;
        state?: string;
        version?: number;
      };
    };
  };
};
```

- [ ] **Step 2: Add `handleOrderPaid` function**

Below `handleOrderReady` (~line 134), add:

```ts
/**
 * Called on order.updated. Fetches the full order, checks it is paid,
 * then enqueues a cup-sticker print job. Idempotent via
 * unique(square_order_id) on print_jobs.
 */
async function handleOrderPaid(orderId: string, eventId?: string): Promise<void> {
  let order;
  try {
    const resp = await squareClient.orders.get({ orderId });
    order = resp.order;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[print] orders.get ${orderId} failed: ${message}`);
    return;
  }
  if (!order) {
    console.log(`[print] orders.get returned no order for ${orderId}`);
    return;
  }

  const result = await enqueuePrintJob({ order });
  if (result.queued) {
    console.log(
      `[print] queued order ${orderId} as ${result.stickerNumber} event_id=${eventId}`,
    );
  } else if (result.reason === "conflict") {
    // Expected on the 2nd+ order.updated event for the same order.
  } else if (result.reason === "not_paid") {
    // Expected for order.updated events before payment posts.
  } else {
    console.error(
      `[print] enqueue skipped order=${orderId} reason=${result.reason}${
        result.detail ? ` detail=${result.detail}` : ""
      } event_id=${eventId}`,
    );
  }
}
```

- [ ] **Step 3: Add the import**

Near the top of the file (~line 1-6), add:

```ts
import { enqueuePrintJob } from "@/lib/print-jobs";
```

- [ ] **Step 4: Wire the branch in `POST`**

Inside `POST`, after the `order.fulfillment.updated` branch (~line 196-208) and before the final `return`, add:

```ts
if (event.type === "order.updated") {
  const orderId = pickUpdatedOrderId(event);
  if (orderId) {
    try {
      await handleOrderPaid(orderId, event.event_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[print] handleOrderPaid threw for order ${orderId} event_id=${event.event_id}: ${message}`,
      );
    }
  }
}
```

- [ ] **Step 5: Type-check**

```bash
cd ~/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: no errors. If errors reference `SquareEvent` or imports, recheck step 1 and 3.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/webhooks/square/route.ts
git commit -m "feat(webhook): enqueue print_job on order.updated when paid"
```

### Task 3.2: Local webhook integration test

**Files:**
- (uses existing `scripts/trigger-order-ready.mjs` as reference)

- [ ] **Step 1: Run the dev server**

```bash
cd ~/Github/mandys_bubble_tea
npm run dev
```
Leave it running.

- [ ] **Step 2: Create a test order in Square Sandbox**

Go to Square Developer Dashboard → Sandbox → your seller account → POS simulator. Create an order with 1 drink and pay with sandbox card. Note the order id.

Alternatively use curl against Square sandbox `POST /v2/orders` then `POST /v2/payments` — but the POS simulator is easier.

- [ ] **Step 3: Verify a print_jobs row was created**

In Supabase SQL editor:
```sql
select id, square_order_id, source, sticker_number, status, cups
from print_jobs
order by created_at desc
limit 3;
```
Expected: one new row with `status='pending'`, `source='pos'` (or `web` if it came through the web flow), correct sticker_number, and a `cups` array with one entry per paid drink.

- [ ] **Step 4: Verify idempotency**

In the Square sandbox, update the order (e.g. add a note). This fires a second `order.updated`. Re-run the query: you should still see exactly one row for that order_id. The webhook log (Vercel logs or your local terminal) should show no duplicate "queued" message.

---

## Phase 4 — Printer client scaffold

### Task 4.1: Create the `printer-client/` package

**Files:**
- Create: `printer-client/package.json`
- Create: `printer-client/tsconfig.json`
- Create: `printer-client/.env.local.example`
- Create: `printer-client/README.md`
- Modify: `.vercelignore`

- [ ] **Step 1: Create directory and package.json**

```bash
cd ~/Github/mandys_bubble_tea
mkdir -p printer-client/src/ui/public
mkdir -p printer-client/scripts printer-client/launchd
```

Create `printer-client/package.json`:

```json
{
  "name": "mandys-printer-client",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test-print": "tsx scripts/test-print.ts",
    "seed-fake-job": "tsx scripts/seed-fake-job.ts"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.103.2",
    "dotenv": "^16.4.5",
    "express": "^4.19.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20",
    "tsx": "^4.19.0",
    "typescript": "^5",
    "vitest": "^1.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "declaration": false
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "src/**/*.test.ts"]
}
```

- [ ] **Step 3: Create .env.local.example**

```
# printer-client/.env.local
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
PRINTER_NAME=Zebra_ZD411
DEVICE_ID=mac-mini-store-davenport
ADMIN_ALERT_ENDPOINT=https://mandybubbletea.com/api/admin/print-alert
PRINTER_ALERT_TOKEN=...
LOCAL_UI_PORT=3001
```

- [ ] **Step 4: Create README.md**

```markdown
# Mandy's Bubble Tea — Printer Client

Local Node service that runs on the in-store Mac mini. Subscribes to the
Supabase `print_jobs` table via Realtime and prints cup stickers on a
USB-connected Zebra ZD411 via CUPS.

## Setup

1. Plug the Zebra ZD411 into the Mac mini via USB.
2. **System Settings → Printers & Scanners → Add Printer** → select the
   Zebra from the USB tab → pick the "Generic Thermal" or "Zebra ZPL"
   driver. Name the printer `Zebra_ZD411` (match `PRINTER_NAME` env).
3. Copy `.env.local.example` to `.env.local` and fill in values. Get the
   Supabase service-role key from the project's Supabase dashboard. Get
   `PRINTER_ALERT_TOKEN` from the Vercel env (must match).
4. `npm install`
5. `npm run test-print` to verify CUPS → Zebra works.
6. `npm run dev` to start the service in watch mode.

## Production (launchd)

See `launchd/com.mandysbubbletea.printer.plist`. Copy to
`~/Library/LaunchAgents/` and `launchctl load` to enable on boot.

## Updating modifier list IDs

Cup stickers rely on `src/lib/modifier-buckets.ts` in the main project
(not this package) to classify modifiers. When adding a new modifier list
to Square Dashboard, update that file, redeploy the Vercel webhook, then
restart this service.

## Troubleshooting

- **Printer shows offline in local UI**: `lpstat -p Zebra_ZD411`; if
  `disabled`, run `cupsenable Zebra_ZD411`. If that fails, re-add in
  System Settings.
- **Jobs stuck in `pending`**: check that Realtime publication includes
  `print_jobs` (see migration). Restart service; `replayOnStart` will
  pick them up if within the 10-minute window.
- **Alerts not firing**: verify `ADMIN_ALERT_ENDPOINT` is reachable from
  the Mac mini; check `PRINTER_ALERT_TOKEN` matches Vercel env.
```

- [ ] **Step 5: Exclude printer-client from Vercel**

In `.vercelignore` (create if missing), add:
```
printer-client/
```

- [ ] **Step 6: Install deps**

```bash
cd ~/Github/mandys_bubble_tea/printer-client
npm install
```
Expected: installs ~250 packages, no errors.

- [ ] **Step 7: Commit**

```bash
cd ~/Github/mandys_bubble_tea
git add printer-client/package.json printer-client/tsconfig.json \
  printer-client/.env.local.example printer-client/README.md \
  printer-client/package-lock.json .vercelignore
git commit -m "chore(printer-client): scaffold package"
```

### Task 4.2: Supabase client

**Files:**
- Create: `printer-client/src/config.ts`
- Create: `printer-client/src/supabase.ts`

- [ ] **Step 1: Write config**

```ts
// printer-client/src/config.ts
import "dotenv/config";

function require(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const config = {
  supabaseUrl: require("SUPABASE_URL"),
  supabaseServiceRoleKey: require("SUPABASE_SERVICE_ROLE_KEY"),
  printerName: process.env.PRINTER_NAME ?? "Zebra_ZD411",
  deviceId: process.env.DEVICE_ID ?? "mac-mini-unknown",
  adminAlertEndpoint: process.env.ADMIN_ALERT_ENDPOINT,
  printerAlertToken: process.env.PRINTER_ALERT_TOKEN,
  localUiPort: Number(process.env.LOCAL_UI_PORT ?? "3001"),
};
```

- [ ] **Step 2: Write supabase client**

```ts
// printer-client/src/supabase.ts
import { createClient } from "@supabase/supabase-js";
import { config } from "./config";

export const supabase = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 10 } },
  },
);
```

- [ ] **Step 3: Commit**

```bash
cd ~/Github/mandys_bubble_tea
git add printer-client/src/config.ts printer-client/src/supabase.ts
git commit -m "feat(printer-client): config + supabase client"
```

### Task 4.3: CUPS printer module

**Files:**
- Create: `printer-client/src/printer.ts`

- [ ] **Step 1: Write the printer module**

```ts
// printer-client/src/printer.ts
import { spawn } from "node:child_process";
import { config } from "./config";

/**
 * Send a ZPL string to the Zebra ZD411 via CUPS (`lp -o raw`).
 * Resolves on lp exit 0, rejects on non-zero or spawn error.
 */
export function printZPL(zpl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const lp = spawn("lp", ["-d", config.printerName, "-o", "raw"]);
    let stderr = "";
    lp.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    lp.on("error", reject);
    lp.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`lp exit ${code}: ${stderr.trim() || "no stderr"}`));
    });
    lp.stdin.end(zpl);
  });
}

/**
 * Query CUPS for the printer status. Returns 'idle', 'printing',
 * 'offline' (disabled / stopped / not present), or 'unknown'.
 */
export async function getPrinterStatus(): Promise<"idle" | "printing" | "offline" | "unknown"> {
  return new Promise((resolve) => {
    const lpstat = spawn("lpstat", ["-p", config.printerName]);
    let stdout = "";
    lpstat.stdout.on("data", (c) => (stdout += c.toString()));
    lpstat.on("error", () => resolve("offline"));
    lpstat.on("exit", () => {
      const s = stdout.toLowerCase();
      if (s.includes("is idle")) resolve("idle");
      else if (s.includes("printing") || s.includes("now printing")) resolve("printing");
      else if (s.includes("disabled") || s.includes("stopped")) resolve("offline");
      else resolve("unknown");
    });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add printer-client/src/printer.ts
git commit -m "feat(printer-client): CUPS lp wrapper + status probe"
```

### Task 4.4: ZPL renderer + tests

**Files:**
- Create: `printer-client/src/zpl.ts`
- Create: `printer-client/src/zpl.test.ts`

- [ ] **Step 1: Write the renderer**

```ts
// printer-client/src/zpl.ts

export type CupForZPL = {
  stickerNumber: string;   // e.g. 'OL812' or 'TA47$**'
  orderTime: string;       // 'HH:mm' in store local time
  drinkName: string;
  toppings: string[];      // multiple join with '+'
  ice: string | null;
  sugar: string | null;
  cupIndex: number;        // 1-based
  cupTotal: number;
  priceCents: number;      // e.g. 700 -> '$7.00'
};

/**
 * Render one cup sticker as a ZPL string for Zebra ZD411 at 203 dpi.
 * Label: 50 mm wide x 30 mm tall -> 400 x 240 dots.
 *
 * Layout (top to bottom):
 *   1. Order number (left, large) + time (right, medium)
 *   2. Drink name (medium, auto-wrap)
 *   3. Toppings -> Ice -> Sugar (small, auto-wrap)
 *   4. Cup index/total (left) + price (right)
 */
export function renderStickerZPL(cup: CupForZPL): string {
  const dollars = (cup.priceCents / 100).toFixed(2);
  const cupFrac = `${cup.cupIndex}/${cup.cupTotal}`;
  const toppings = cup.toppings.length > 0 ? cup.toppings.join("+") : "";
  const ice = cup.ice ?? "";
  const sugar = cup.sugar ?? "";
  const modifierLine = `${toppings} -> ${ice} -> ${sugar}`.trim();

  // Font sizes (dots). Font 0 is scalable height x width.
  const H_NUM = 45;     // order number
  const H_TIME = 32;    // time
  const H_DRINK = 30;   // drink name
  const H_MOD = 24;     // modifier line
  const H_FOOT = 26;    // footer

  // Vertical cursor. Leave 10 dots padding top.
  let y = 10;

  const parts: string[] = [];
  parts.push("^XA");           // start
  parts.push("^PW400");        // print width (50mm @ 203dpi)
  parts.push("^LL240");        // label length (30mm @ 203dpi)
  parts.push("^CI28");         // UTF-8

  // Row 1: sticker number (left) + time (right, top-right)
  parts.push(`^FO15,${y}^A0N,${H_NUM},${H_NUM}^FD${escapeZpl(cup.stickerNumber)}^FS`);
  parts.push(`^FO270,${y + 10}^A0N,${H_TIME},${H_TIME}^FD${escapeZpl(cup.orderTime)}^FS`);
  y += H_NUM + 6;

  // Row 2: drink name, auto-wrap up to 2 lines at ~22 chars per line
  parts.push(
    `^FO15,${y}^A0N,${H_DRINK},${H_DRINK}^FB370,2,4,L,0^FD${escapeZpl(cup.drinkName)}^FS`,
  );
  y += H_DRINK * 2 + 4;

  // Row 3: modifiers, auto-wrap up to 2 lines
  parts.push(
    `^FO15,${y}^A0N,${H_MOD},${H_MOD}^FB370,2,2,L,0^FD${escapeZpl(modifierLine)}^FS`,
  );
  y += H_MOD * 2 + 4;

  // Row 4: cup fraction (left) + price (right)
  parts.push(`^FO15,${y}^A0N,${H_FOOT},${H_FOOT}^FD${escapeZpl(cupFrac)}^FS`);
  parts.push(`^FO280,${y}^A0N,${H_FOOT},${H_FOOT}^FD$${escapeZpl(dollars)}^FS`);

  parts.push("^XZ");           // end
  return parts.join("\n");
}

// Escape characters that have special meaning in ZPL (^ ~ \ caret, tilde,
// backslash). If any of these appear in drink/modifier names they'd break
// parsing on the printer. Replace with ASCII-safe equivalents.
function escapeZpl(s: string): string {
  return s.replace(/\\/g, "/").replace(/\^/g, "-").replace(/~/g, "-");
}
```

- [ ] **Step 2: Write the tests**

```ts
// printer-client/src/zpl.test.ts
import { describe, it, expect } from "vitest";
import { renderStickerZPL } from "./zpl";

describe("renderStickerZPL", () => {
  const base = {
    stickerNumber: "OL812",
    orderTime: "21:35",
    drinkName: "Brown Sugar Milk Tea",
    toppings: ["Pearls"],
    ice: "Less Ice",
    sugar: "Half Sugar",
    cupIndex: 1,
    cupTotal: 2,
    priceCents: 700,
  };

  it("produces a ZPL string with ^XA start and ^XZ end", () => {
    const z = renderStickerZPL(base);
    expect(z.startsWith("^XA")).toBe(true);
    expect(z.endsWith("^XZ")).toBe(true);
  });

  it("includes sticker number, time, drink name, modifiers, cup index, and price", () => {
    const z = renderStickerZPL(base);
    expect(z).toContain("OL812");
    expect(z).toContain("21:35");
    expect(z).toContain("Brown Sugar Milk Tea");
    expect(z).toContain("Pearls -> Less Ice -> Half Sugar");
    expect(z).toContain("1/2");
    expect(z).toContain("$7.00");
  });

  it("joins multiple toppings with '+'", () => {
    const z = renderStickerZPL({ ...base, toppings: ["Pearls", "Grass Jelly"] });
    expect(z).toContain("Pearls+Grass Jelly");
  });

  it("renders missing ice/sugar as empty between the '->' separators", () => {
    const z = renderStickerZPL({ ...base, ice: null, sugar: null });
    expect(z).toContain("Pearls ->  ->");
  });

  it("handles no toppings + present ice/sugar", () => {
    const z = renderStickerZPL({ ...base, toppings: [], ice: "Normal Ice", sugar: "Normal Sugar" });
    expect(z).toContain("-> Normal Ice -> Normal Sugar");
  });

  it("escapes ZPL metacharacters in drink name", () => {
    const z = renderStickerZPL({ ...base, drinkName: "Brown ^ Sugar ~ Milk" });
    expect(z).not.toContain("^ Sugar");
    expect(z).not.toContain("~ Milk");
  });

  it("formats price with two decimals even for round dollar amounts", () => {
    const z = renderStickerZPL({ ...base, priceCents: 500 });
    expect(z).toContain("$5.00");
  });

  it("handles long drink names via auto-wrap (smoke, length doesn't crash)", () => {
    const z = renderStickerZPL({
      ...base,
      drinkName: "Extra Large Brown Sugar Boba Milk Tea Deluxe Edition",
    });
    expect(z.startsWith("^XA")).toBe(true);
    expect(z).toContain("^FB");
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
cd ~/Github/mandys_bubble_tea/printer-client
npm test
```
Expected: 8 tests pass.

- [ ] **Step 4: Preview output on labelary.com**

Run:
```bash
cd ~/Github/mandys_bubble_tea/printer-client
npx tsx -e "import {renderStickerZPL} from './src/zpl'; console.log(renderStickerZPL({stickerNumber:'OL812',orderTime:'21:35',drinkName:'Brown Sugar Milk Tea',toppings:['Pearls'],ice:'Less Ice',sugar:'Half Sugar',cupIndex:1,cupTotal:2,priceCents:700}))"
```
Copy the output, paste into https://labelary.com/viewer.html — confirm the rendered preview at 50×30mm 203dpi looks reasonable (order number top-left, time top-right, drink name, modifiers, footer). If elements overflow, open `zpl.ts` and adjust the H_* constants or `^FB` widths.

- [ ] **Step 5: Commit**

```bash
cd ~/Github/mandys_bubble_tea
git add printer-client/src/zpl.ts printer-client/src/zpl.test.ts
git commit -m "feat(printer-client): ZPL renderer for 50x30mm cup sticker"
```

### Task 4.5: Queue module (subscribe + handleJob)

**Files:**
- Create: `printer-client/src/queue.ts`

- [ ] **Step 1: Write the module**

```ts
// printer-client/src/queue.ts
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { printZPL } from "./printer";
import { renderStickerZPL, type CupForZPL } from "./zpl";
import { maybeAlert } from "./alert";

type PrintJobRow = {
  id: string;
  square_order_id: string;
  source: "web" | "pos";
  sticker_number: string;
  order_total_cents: number;
  cups: Array<{
    drinkName: string;
    toppings: string[];
    ice: string | null;
    sugar: string | null;
    priceCents: number;
  }>;
  status: "pending" | "printed" | "failed" | "stale";
  attempts: number;
  last_error: string | null;
  created_at: string;
};

const REPLAY_WINDOW_MS = 10 * 60 * 1000;

/**
 * Runs once at start. Jobs older than the replay window are marked
 * 'stale'; remaining pending jobs are processed in creation order.
 */
export async function replayOnStart(): Promise<void> {
  const cutoff = new Date(Date.now() - REPLAY_WINDOW_MS).toISOString();
  const { error: staleErr } = await supabase
    .from("print_jobs")
    .update({ status: "stale" })
    .lt("created_at", cutoff)
    .eq("status", "pending");
  if (staleErr) console.error("[queue] stale mark failed:", staleErr.message);

  const { data, error } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[queue] replay select failed:", error.message);
    return;
  }
  for (const row of (data ?? []) as PrintJobRow[]) {
    await handleJob(row);
  }
}

/**
 * Subscribes to INSERT events on print_jobs via Supabase Realtime.
 * Returns the channel so the caller can unsubscribe on shutdown.
 */
export function subscribePrintJobs(): RealtimeChannel {
  return supabase
    .channel("print_jobs")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "print_jobs" },
      async (payload) => {
        const row = payload.new as PrintJobRow;
        if (row.status !== "pending") return;
        await handleJob(row);
      },
    )
    .subscribe((status) => {
      console.log(`[queue] realtime status: ${status}`);
    });
}

export async function handleJob(job: PrintJobRow): Promise<void> {
  try {
    const orderTime = formatLocalTime(job.created_at);
    for (let i = 0; i < job.cups.length; i++) {
      const c = job.cups[i];
      const zpl = renderStickerZPL({
        stickerNumber: job.sticker_number,
        orderTime,
        drinkName: c.drinkName,
        toppings: c.toppings,
        ice: c.ice,
        sugar: c.sugar,
        cupIndex: i + 1,
        cupTotal: job.cups.length,
        priceCents: c.priceCents,
      } satisfies CupForZPL);
      await printZPL(zpl);
    }
    await supabase
      .from("print_jobs")
      .update({ status: "printed", printed_at: new Date().toISOString() })
      .eq("id", job.id);
    console.log(`[queue] printed ${job.sticker_number} (${job.cups.length} cups)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const newAttempts = job.attempts + 1;
    await supabase
      .from("print_jobs")
      .update({ status: "failed", attempts: newAttempts, last_error: message })
      .eq("id", job.id);
    console.error(`[queue] failed ${job.sticker_number}: ${message}`);
    if (newAttempts >= 3) await maybeAlert(`print failed ${newAttempts}x: ${message}`);
  }
}

/**
 * Formats an ISO timestamp into 'HH:mm' in Australia/Brisbane.
 */
function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-AU", {
    timeZone: "Australia/Brisbane",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/Github/mandys_bubble_tea
git add printer-client/src/queue.ts
git commit -m "feat(printer-client): Realtime subscribe + handleJob + replayOnStart"
```

### Task 4.6: Alert + heartbeat modules (stubs now, wired later)

**Files:**
- Create: `printer-client/src/alert.ts`
- Create: `printer-client/src/heartbeat.ts`

- [ ] **Step 1: Write alert.ts**

```ts
// printer-client/src/alert.ts
import { config } from "./config";

// Dedup: don't send the same error within 5 minutes.
const recent: Map<string, number> = new Map();
const DEDUP_MS = 5 * 60 * 1000;

export async function maybeAlert(message: string): Promise<void> {
  if (!config.adminAlertEndpoint || !config.printerAlertToken) {
    console.warn("[alert] endpoint or token missing, skipping:", message);
    return;
  }
  const now = Date.now();
  const last = recent.get(message) ?? 0;
  if (now - last < DEDUP_MS) return;
  recent.set(message, now);
  try {
    const res = await fetch(config.adminAlertEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.printerAlertToken}`,
      },
      body: JSON.stringify({
        deviceId: config.deviceId,
        message,
        at: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      console.error(`[alert] endpoint returned ${res.status}`);
    }
  } catch (err) {
    console.error("[alert] POST failed:", err);
  }
}
```

- [ ] **Step 2: Write heartbeat.ts**

```ts
// printer-client/src/heartbeat.ts
import { supabase } from "./supabase";
import { config } from "./config";
import { getPrinterStatus } from "./printer";

const HEARTBEAT_INTERVAL_MS = 30 * 1000;

export function startHeartbeat(): NodeJS.Timeout {
  const tick = async () => {
    try {
      const [printerStatus, pendingResult] = await Promise.all([
        getPrinterStatus(),
        supabase.from("print_jobs").select("id", { count: "exact", head: true }).eq("status", "pending"),
      ]);
      const pendingCount = pendingResult.count ?? 0;
      await supabase.from("printer_heartbeats").upsert({
        device_id: config.deviceId,
        last_seen_at: new Date().toISOString(),
        printer_status: printerStatus,
        pending_count: pendingCount,
      });
    } catch (err) {
      console.error("[heartbeat] tick failed:", err);
    }
  };
  tick();
  return setInterval(tick, HEARTBEAT_INTERVAL_MS);
}
```

- [ ] **Step 3: Commit**

```bash
git add printer-client/src/alert.ts printer-client/src/heartbeat.ts
git commit -m "feat(printer-client): alert + heartbeat modules"
```

### Task 4.7: Entry point

**Files:**
- Create: `printer-client/src/index.ts`

- [ ] **Step 1: Write the entry point (no UI yet — added in Phase 6)**

```ts
// printer-client/src/index.ts
import { replayOnStart, subscribePrintJobs } from "./queue";
import { startHeartbeat } from "./heartbeat";

async function main() {
  console.log("[main] starting Mandy's printer client");
  await replayOnStart();
  const channel = subscribePrintJobs();
  const hbTimer = startHeartbeat();

  const shutdown = (sig: string) => {
    console.log(`[main] ${sig} received, shutting down`);
    clearInterval(hbTimer);
    channel.unsubscribe();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[main] fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add printer-client/src/index.ts
git commit -m "feat(printer-client): entry point (replay + subscribe + heartbeat)"
```

### Task 4.8: Test print script

**Files:**
- Create: `printer-client/scripts/test-print.ts`

- [ ] **Step 1: Write the script**

```ts
// printer-client/scripts/test-print.ts
import { printZPL } from "../src/printer";
import { renderStickerZPL } from "../src/zpl";

async function main() {
  const zpl = renderStickerZPL({
    stickerNumber: "TEST",
    orderTime: new Date().toLocaleTimeString("en-AU", {
      timeZone: "Australia/Brisbane",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    drinkName: "Test Print",
    toppings: ["Pearls"],
    ice: "Less Ice",
    sugar: "Half Sugar",
    cupIndex: 1,
    cupTotal: 1,
    priceCents: 0,
  });
  console.log(zpl);
  await printZPL(zpl);
  console.log("[test-print] sent to", process.env.PRINTER_NAME ?? "Zebra_ZD411");
}

main().catch((err) => {
  console.error("[test-print] failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add printer-client/scripts/test-print.ts
git commit -m "feat(printer-client): test-print smoke script"
```

### Task 4.9: Add Zebra to macOS CUPS and run smoke test

- [ ] **Step 1: Physical setup**

Plug the Zebra ZD411 into the Mac mini via USB. Power on, load 50×30mm thermal labels. Press and hold the Feed button for ~5s until the printer beeps once to trigger SmartCal (auto label calibration).

- [ ] **Step 2: Add the printer in macOS**

Open **System Settings → Printers & Scanners → Add Printer → USB**. Select the Zebra. In the "Use" dropdown pick "Zebra ZPL Label Printer" if listed; if not, choose "Generic / Generic PostScript Printer" and click Add. Rename it `Zebra_ZD411` in the printer's properties.

- [ ] **Step 3: Verify CUPS sees it**

```bash
lpstat -p Zebra_ZD411
```
Expected: `printer Zebra_ZD411 is idle. enabled since ...`

- [ ] **Step 4: Copy env config**

```bash
cd ~/Github/mandys_bubble_tea/printer-client
cp .env.local.example .env.local
# Open .env.local and fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
# PRINTER_ALERT_TOKEN and ADMIN_ALERT_ENDPOINT can stay blank for now
# (alerts won't fire until Phase 6).
```

- [ ] **Step 5: Run test print**

```bash
npm run test-print
```
Expected: a sticker prints with "TEST" + "Test Print" drink name. If nothing comes out:
- Check `lpstat -p Zebra_ZD411` is `idle`.
- If the printer output is garbage, the driver pick was wrong — re-add with "Raw Queue" or install Zebra's official driver and try again.

### Task 4.10: End-to-end smoke (webhook → Realtime → print)

**Files:**
- Create: `printer-client/scripts/seed-fake-job.ts`

- [ ] **Step 1: Write the seed script**

```ts
// printer-client/scripts/seed-fake-job.ts
import { supabase } from "../src/supabase";

async function main() {
  const rand = Math.random().toString(36).slice(2, 10);
  const { data, error } = await supabase.from("print_jobs").insert({
    square_order_id: `fake-${rand}`,
    source: "pos",
    sticker_number: "TA99",
    order_total_cents: 700,
    cups: [
      {
        drinkName: "Brown Sugar Milk Tea",
        toppings: ["Pearls"],
        ice: "Less Ice",
        sugar: "Half Sugar",
        priceCents: 700,
      },
    ],
  }).select().single();
  if (error) throw error;
  console.log("[seed] inserted fake print_job", data?.id);
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the client and verify**

In one terminal:
```bash
cd ~/Github/mandys_bubble_tea/printer-client
npm run dev
```
Expected output includes `[queue] realtime status: SUBSCRIBED`.

In another terminal:
```bash
cd ~/Github/mandys_bubble_tea/printer-client
npm run seed-fake-job
```
Expected: within ~2s the first terminal logs `[queue] printed TA99 (1 cups)` and a real sticker prints.

- [ ] **Step 3: Verify DB state**

In Supabase SQL editor:
```sql
select id, sticker_number, status, printed_at
from print_jobs
where square_order_id like 'fake-%'
order by created_at desc
limit 3;
```
Expected: `status='printed'`, `printed_at` non-null.

- [ ] **Step 4: Commit the seed script**

```bash
cd ~/Github/mandys_bubble_tea
git add printer-client/scripts/seed-fake-job.ts
git commit -m "feat(printer-client): seed-fake-job script for E2E smoke"
```

---

## Phase 5 — Production supervision (launchd)

### Task 5.1: Build the client once

- [ ] **Step 1: Compile TS to JS**

```bash
cd ~/Github/mandys_bubble_tea/printer-client
npm run build
```
Expected: a `dist/` folder with compiled `.js`.

- [ ] **Step 2: Smoke-test the built version**

```bash
node dist/index.js &
sleep 3
cat > /tmp/smoke.sh <<'EOF'
cd ~/Github/mandys_bubble_tea/printer-client && npm run seed-fake-job
EOF
sh /tmp/smoke.sh
wait
```
Expected: built service prints a sticker.

### Task 5.2: launchd plist

**Files:**
- Create: `printer-client/launchd/com.mandysbubbletea.printer.plist`

- [ ] **Step 1: Write the plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.mandysbubbletea.printer</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/REPLACE_USER/Github/mandys_bubble_tea/printer-client/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/REPLACE_USER/Github/mandys_bubble_tea/printer-client</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/REPLACE_USER/Library/Logs/mandys-printer.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/REPLACE_USER/Library/Logs/mandys-printer.err.log</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
```

- [ ] **Step 2: Install the plist**

```bash
# On the Mac mini:
USER_NAME=$(whoami)
mkdir -p ~/Library/LaunchAgents ~/Library/Logs
sed "s#REPLACE_USER#${USER_NAME}#g" \
  ~/Github/mandys_bubble_tea/printer-client/launchd/com.mandysbubbletea.printer.plist \
  > ~/Library/LaunchAgents/com.mandysbubbletea.printer.plist

# Locate node binary; plist uses /usr/local/bin/node. If node is elsewhere
# (e.g. Homebrew on Apple Silicon at /opt/homebrew/bin/node), adjust the
# plist ProgramArguments[0] before loading.
which node
# If not /usr/local/bin/node, edit ~/Library/LaunchAgents/com.mandysbubbletea.printer.plist accordingly.

launchctl unload ~/Library/LaunchAgents/com.mandysbubbletea.printer.plist 2>/dev/null
launchctl load -w ~/Library/LaunchAgents/com.mandysbubbletea.printer.plist
```

- [ ] **Step 3: Verify**

```bash
launchctl list | grep mandysbubbletea
tail -n 20 ~/Library/Logs/mandys-printer.log
```
Expected: `list` shows the service with a PID. Log shows `[main] starting Mandy's printer client` and `[queue] realtime status: SUBSCRIBED`.

- [ ] **Step 4: Test auto-restart**

```bash
# Find the PID:
PID=$(launchctl list | awk '/mandysbubbletea/ {print $1}')
kill $PID
sleep 12
launchctl list | grep mandysbubbletea
```
Expected: a new PID appears (launchd restarted after ThrottleInterval).

- [ ] **Step 5: Commit**

```bash
cd ~/Github/mandys_bubble_tea
git add printer-client/launchd/com.mandysbubbletea.printer.plist
git commit -m "feat(printer-client): launchd plist for Mac mini production"
```

---

## Phase 6 — Alerts (Vercel endpoint + Mac mini wiring)

### Task 6.1: Add `PRINTER_ALERT_TOKEN` env var

- [ ] **Step 1: Generate a random token**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy the output.

- [ ] **Step 2: Set on Vercel**

Vercel Dashboard → Project → Settings → Environment Variables → Add `PRINTER_ALERT_TOKEN` with the generated value. Select all environments (Production, Preview, Development).

- [ ] **Step 3: Also add to Mac mini `.env.local`**

```bash
# On the Mac mini:
cd ~/Github/mandys_bubble_tea/printer-client
# Edit .env.local and set:
# PRINTER_ALERT_TOKEN=<same token as Vercel>
# ADMIN_ALERT_ENDPOINT=https://mandybubbletea.com/api/admin/print-alert
```

### Task 6.2: Vercel alert endpoint

**Files:**
- Create: `src/app/api/admin/print-alert/route.ts`

- [ ] **Step 1: Write the endpoint**

```ts
// src/app/api/admin/print-alert/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { sendExpoPush } from "@/lib/push";

export const dynamic = "force-dynamic";

type AlertBody = {
  deviceId?: string;
  message?: string;
  at?: string;
};

export async function POST(request: Request) {
  const expected = process.env.PRINTER_ALERT_TOKEN;
  if (!expected) {
    console.error("[print-alert] PRINTER_ALERT_TOKEN not configured on server");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  let body: AlertBody;
  try {
    body = (await request.json()) as AlertBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const message = String(body.message ?? "").slice(0, 280) || "printer alert";
  const deviceId = String(body.deviceId ?? "unknown");

  const admin = getSupabaseAdmin();

  // Find all owner user_ids, then their device push tokens.
  const { data: owners, error: ownerErr } = await admin
    .from("admin_users")
    .select("user_id")
    .eq("role", "owner");
  if (ownerErr) {
    console.error("[print-alert] admin_users query failed:", ownerErr.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  const ownerIds = (owners ?? []).map((r: { user_id: string }) => r.user_id);
  if (ownerIds.length === 0) {
    console.warn("[print-alert] no owners configured");
    return NextResponse.json({ ok: true, delivered: 0 });
  }
  const { data: tokens, error: tokensErr } = await admin
    .from("device_push_tokens")
    .select("token")
    .in("user_id", ownerIds);
  if (tokensErr) {
    console.error("[print-alert] push tokens query failed:", tokensErr.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  const pushTokens = (tokens ?? []).map((t: { token: string }) => t.token);
  if (pushTokens.length === 0) {
    return NextResponse.json({ ok: true, delivered: 0 });
  }

  const delivered = await sendExpoPush(pushTokens, {
    title: "Printer alert",
    body: `${deviceId}: ${message}`,
    data: { kind: "printer-alert", deviceId, message },
  });
  console.log(`[print-alert] delivered ${delivered}/${pushTokens.length} device=${deviceId}`);
  return NextResponse.json({ ok: true, delivered });
}
```

- [ ] **Step 2: Type-check**

```bash
cd ~/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/print-alert/route.ts
git commit -m "feat(admin): print-alert endpoint (Bearer-token gated Expo push)"
```

### Task 6.3: Add pending-age alert ticker to Mac mini

**Files:**
- Modify: `printer-client/src/heartbeat.ts`

- [ ] **Step 1: Add a separate age-check ticker**

Append to `printer-client/src/heartbeat.ts`:

```ts
import { maybeAlert } from "./alert";

const PENDING_AGE_ALERT_MS = 2 * 60 * 1000;

export function startPendingAgeWatch(): NodeJS.Timeout {
  const check = async () => {
    try {
      const { data, error } = await supabase
        .from("print_jobs")
        .select("id, created_at, sticker_number")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(1);
      if (error) return;
      const row = (data ?? [])[0];
      if (!row) return;
      const ageMs = Date.now() - new Date(row.created_at).getTime();
      if (ageMs >= PENDING_AGE_ALERT_MS) {
        await maybeAlert(
          `oldest pending ${row.sticker_number} aged ${Math.round(ageMs / 1000)}s`,
        );
      }
    } catch (err) {
      console.error("[age-watch] failed:", err);
    }
  };
  return setInterval(check, 30 * 1000);
}
```

- [ ] **Step 2: Wire it in index.ts**

Open `printer-client/src/index.ts`. Update:

```ts
import { startHeartbeat, startPendingAgeWatch } from "./heartbeat";
```

Inside `main()`, after `startHeartbeat()`:

```ts
  const ageTimer = startPendingAgeWatch();
```

Inside `shutdown`:
```ts
    clearInterval(ageTimer);
```

- [ ] **Step 3: Rebuild and verify**

```bash
cd ~/Github/mandys_bubble_tea/printer-client
npm run build
launchctl unload ~/Library/LaunchAgents/com.mandysbubbletea.printer.plist
launchctl load -w ~/Library/LaunchAgents/com.mandysbubbletea.printer.plist
tail -f ~/Library/Logs/mandys-printer.log
```
Leave the tail running.

- [ ] **Step 4: Force an alert (turn off Zebra, seed a fake job)**

On the Mac mini, turn off the Zebra via System Settings → Printers → ⎯ (pause queue). Run:
```bash
cd ~/Github/mandys_bubble_tea/printer-client
npm run seed-fake-job
```
Wait ~2.5 minutes. Expected: the owner's iPhone gets a push titled "Printer alert". Re-enable the printer queue afterwards (the job will have transitioned to `failed` after lp errors; use the upcoming `/admin/prints` remote reprint or another fake seed to verify recovery).

- [ ] **Step 5: Commit**

```bash
cd ~/Github/mandys_bubble_tea
git add printer-client/src/heartbeat.ts printer-client/src/index.ts
git commit -m "feat(printer-client): alert on pending age > 2 minutes"
```

---

## Phase 7 — Local UI (Mac mini)

### Task 7.1: Express routes + reprint endpoint

**Files:**
- Create: `printer-client/src/ui/server.ts`

- [ ] **Step 1: Write server.ts**

```ts
// printer-client/src/ui/server.ts
import express from "express";
import path from "node:path";
import { supabase } from "../supabase";
import { handleJob } from "../queue";
import { getPrinterStatus } from "../printer";
import { config } from "../config";

export function startUi(): void {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));

  app.get("/api/status", async (_req, res) => {
    const [printerStatus, pendingResult] = await Promise.all([
      getPrinterStatus(),
      supabase.from("print_jobs").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    res.json({
      printerStatus,
      pendingCount: pendingResult.count ?? 0,
      deviceId: config.deviceId,
    });
  });

  app.get("/api/jobs", async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const { data, error } = await supabase
      .from("print_jobs")
      .select("id, sticker_number, source, status, cups, created_at, printed_at, attempts, last_error")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ jobs: data ?? [] });
  });

  app.post("/api/jobs/:id/reprint", async (req, res) => {
    const id = req.params.id;
    const { data: orig, error: origErr } = await supabase
      .from("print_jobs")
      .select("*")
      .eq("id", id)
      .single();
    if (origErr || !orig) return res.status(404).json({ error: "not found" });
    const synthetic = `reprint:${orig.square_order_id}:${new Date().toISOString()}`;
    const { data: cloned, error: cloneErr } = await supabase
      .from("print_jobs")
      .insert({
        square_order_id: synthetic,
        source: orig.source,
        sticker_number: orig.sticker_number,
        order_total_cents: orig.order_total_cents,
        cups: orig.cups,
        status: "pending",
      })
      .select()
      .single();
    if (cloneErr) return res.status(500).json({ error: cloneErr.message });
    res.json({ ok: true, clonedId: cloned.id });
  });

  app.post("/api/test-print", async (_req, res) => {
    const { renderStickerZPL } = await import("../zpl");
    const { printZPL } = await import("../printer");
    const zpl = renderStickerZPL({
      stickerNumber: "TEST",
      orderTime: new Date().toLocaleTimeString("en-AU", { timeZone: "Australia/Brisbane", hour: "2-digit", minute: "2-digit", hour12: false }),
      drinkName: "Test Print",
      toppings: ["Pearls"],
      ice: "Less Ice",
      sugar: "Half Sugar",
      cupIndex: 1,
      cupTotal: 1,
      priceCents: 0,
    });
    try {
      await printZPL(zpl);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.listen(config.localUiPort, "127.0.0.1", () => {
    console.log(`[ui] listening on http://localhost:${config.localUiPort}`);
  });
}
```

- [ ] **Step 2: Wire it in index.ts**

Open `printer-client/src/index.ts`. At the top, add:
```ts
import { startUi } from "./ui/server";
```
After `startPendingAgeWatch()`, add:
```ts
  startUi();
```

- [ ] **Step 3: Commit**

```bash
cd ~/Github/mandys_bubble_tea
git add printer-client/src/ui/server.ts printer-client/src/index.ts
git commit -m "feat(printer-client): localhost:3001 UI server (status, jobs, reprint, test-print)"
```

### Task 7.2: HTML + JS

**Files:**
- Create: `printer-client/src/ui/public/index.html`
- Create: `printer-client/src/ui/public/app.js`

- [ ] **Step 1: Write index.html**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Mandy's Printer</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; margin: 24px; background: #fafafa; color: #222; }
    h1 { font-size: 22px; margin: 0 0 12px; }
    .status { padding: 12px; border-radius: 8px; margin-bottom: 16px; background: white; box-shadow: 0 1px 2px rgba(0,0,0,.06); display: flex; gap: 16px; align-items: center; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .green { background: #22c55e; } .red { background: #ef4444; } .yellow { background: #eab308; }
    button { padding: 8px 14px; border-radius: 6px; border: 1px solid #ccc; background: white; cursor: pointer; font-size: 14px; }
    button:hover { background: #f0f0f0; }
    table { border-collapse: collapse; width: 100%; background: white; }
    th, td { border-bottom: 1px solid #eee; padding: 8px 10px; text-align: left; font-size: 13px; }
    th { background: #f5f5f5; }
    .status-pending { color: #b45309; }
    .status-printed { color: #15803d; }
    .status-failed { color: #b91c1c; }
    .status-stale { color: #6b7280; }
  </style>
</head>
<body>
  <h1>Mandy's Printer Control</h1>
  <div class="status" id="status">Loading…</div>
  <div style="margin-bottom: 16px;">
    <button id="testBtn">Test Print</button>
    <button id="refreshBtn">Refresh</button>
  </div>
  <table>
    <thead><tr><th>Sticker</th><th>Source</th><th>Status</th><th>When</th><th>Cups</th><th></th></tr></thead>
    <tbody id="jobs"></tbody>
  </table>
  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write app.js**

```js
// printer-client/src/ui/public/app.js
async function refresh() {
  const [statusRes, jobsRes] = await Promise.all([
    fetch("/api/status").then((r) => r.json()),
    fetch("/api/jobs?limit=20").then((r) => r.json()),
  ]);
  const statusEl = document.getElementById("status");
  const dotClass = statusRes.printerStatus === "idle" || statusRes.printerStatus === "printing" ? "green"
    : statusRes.printerStatus === "offline" ? "red" : "yellow";
  statusEl.innerHTML = `
    <span class="dot ${dotClass}"></span>
    Printer: <strong>${statusRes.printerStatus}</strong>
    &nbsp;|&nbsp; Pending: <strong>${statusRes.pendingCount}</strong>
    &nbsp;|&nbsp; Device: <code>${statusRes.deviceId}</code>
  `;
  const tbody = document.getElementById("jobs");
  tbody.innerHTML = "";
  for (const job of jobsRes.jobs) {
    const tr = document.createElement("tr");
    const when = new Date(job.created_at).toLocaleTimeString("en-AU", {
      timeZone: "Australia/Brisbane", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    });
    const cupDesc = (job.cups || []).map((c) => c.drinkName).join(", ");
    tr.innerHTML = `
      <td><strong>${job.sticker_number}</strong></td>
      <td>${job.source}</td>
      <td class="status-${job.status}">${job.status}${job.attempts > 0 ? " ("+job.attempts+"x)" : ""}</td>
      <td>${when}</td>
      <td>${cupDesc}</td>
      <td><button data-id="${job.id}" class="reprint">Reprint</button></td>
    `;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll("button.reprint").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Reprint this job?")) return;
      const id = btn.dataset.id;
      const r = await fetch(`/api/jobs/${id}/reprint`, { method: "POST" });
      if (r.ok) refresh();
      else alert("Reprint failed: " + (await r.text()));
    });
  });
}
document.getElementById("testBtn").addEventListener("click", async () => {
  const r = await fetch("/api/test-print", { method: "POST" });
  alert(r.ok ? "Test sent!" : "Test failed: " + (await r.text()));
});
document.getElementById("refreshBtn").addEventListener("click", refresh);
refresh();
setInterval(refresh, 5000);
```

- [ ] **Step 3: Include static assets in TS build output**

Since TypeScript compiles only `.ts`, the HTML/JS need to be copied to `dist/ui/public/` for the built version. Update `printer-client/package.json` scripts:

```json
"build": "tsc && mkdir -p dist/ui/public && cp src/ui/public/* dist/ui/public/",
```

Update the scripts object's `build` value to the above. (The `"scripts"` block in package.json should now contain this exact `build` line.)

- [ ] **Step 4: Rebuild and reload**

```bash
cd ~/Github/mandys_bubble_tea/printer-client
npm run build
launchctl unload ~/Library/LaunchAgents/com.mandysbubbletea.printer.plist
launchctl load -w ~/Library/LaunchAgents/com.mandysbubbletea.printer.plist
```

- [ ] **Step 5: Manual verify in browser**

Open `http://localhost:3001` on the Mac mini. Expected:
- Green/red status dot
- Printer name and pending count
- Table with recent jobs (including the `fake-*` ones from earlier)
- "Test Print" button fires a sticker
- "Reprint" on any row clones the job and prints a new sticker

- [ ] **Step 6: Commit**

```bash
cd ~/Github/mandys_bubble_tea
git add printer-client/src/ui/public/index.html printer-client/src/ui/public/app.js printer-client/package.json
git commit -m "feat(printer-client): localhost UI (status, recent jobs, reprint, test print)"
```

---

## Phase 8 — Remote admin UI

### Task 8.1: Admin auth gate

**Files:**
- Create: `src/app/admin/layout.tsx`

- [ ] **Step 1: Check how other pages read the current user**

Search `src/app` for an existing authed page pattern:
```bash
grep -rn "getAuthedUser\|getServerUser\|auth().getUser" src/app | head -10
```
Use whichever helper is already in `src/lib/auth.ts` (per `src/app/api/orders/route.ts:67` the main project uses `getAuthedUser(request)`; a Server Component equivalent should exist — if not, implement it using `@supabase/ssr`).

- [ ] **Step 2: Write the admin layout**

```tsx
// src/app/admin/layout.tsx
import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const ssr = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    },
  );
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) redirect("/");
  const admin = getSupabaseAdmin();
  const { data: row } = await admin
    .from("admin_users")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) notFound();
  return <>{children}</>;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/layout.tsx
git commit -m "feat(admin): auth gate for /admin routes (admin_users allow-list)"
```

### Task 8.2: /admin/prints page

**Files:**
- Create: `src/app/admin/prints/page.tsx`

- [ ] **Step 1: Write the page (Server Component that fetches + inlines a Client Component table)**

```tsx
// src/app/admin/prints/page.tsx
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { PrintsTable } from "./table";

export const dynamic = "force-dynamic";

export default async function AdminPrintsPage() {
  const admin = getSupabaseAdmin();
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();

  const [statsResult, jobsResult, heartbeatResult] = await Promise.all([
    admin.from("print_jobs").select("status", { count: "exact" }).gte("created_at", startOfDay),
    admin.from("print_jobs").select("*").order("created_at", { ascending: false }).limit(100),
    admin.from("printer_heartbeats").select("*"),
  ]);

  const byStatus = { pending: 0, printed: 0, failed: 0, stale: 0 };
  for (const r of statsResult.data ?? []) {
    const s = (r as { status: keyof typeof byStatus }).status;
    if (s in byStatus) byStatus[s]++;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Print jobs</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Pending" value={byStatus.pending} />
        <Stat label="Printed today" value={byStatus.printed} />
        <Stat label="Failed" value={byStatus.failed} />
        <Stat label="Stale" value={byStatus.stale} />
      </div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Devices</h2>
        <ul className="space-y-1 text-sm">
          {(heartbeatResult.data ?? []).map((h: any) => {
            const ageSec = Math.round((Date.now() - new Date(h.last_seen_at).getTime()) / 1000);
            const healthy = ageSec < 120;
            return (
              <li key={h.device_id} className={healthy ? "text-green-700" : "text-red-700"}>
                <code>{h.device_id}</code> — printer {h.printer_status}, pending {h.pending_count}, seen {ageSec}s ago
              </li>
            );
          })}
        </ul>
      </div>
      <PrintsTable jobs={(jobsResult.data ?? []) as any} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-4 rounded-lg border bg-white">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
```

- [ ] **Step 2: Write the table (Client Component for reprint button)**

```tsx
// src/app/admin/prints/table.tsx
"use client";
import { useState } from "react";

type Job = {
  id: string;
  square_order_id: string;
  source: string;
  sticker_number: string;
  status: string;
  attempts: number;
  cups: Array<{ drinkName: string }>;
  created_at: string;
  last_error: string | null;
};

export function PrintsTable({ jobs }: { jobs: Job[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  async function reprint(id: string) {
    if (!confirm("Clone and reprint this job?")) return;
    setBusyId(id);
    try {
      const r = await fetch("/api/admin/prints/reprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) alert("Reprint failed: " + (await r.text()));
      else location.reload();
    } finally {
      setBusyId(null);
    }
  }
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="bg-gray-100 text-left">
          <th className="p-2">Sticker</th>
          <th className="p-2">Source</th>
          <th className="p-2">Status</th>
          <th className="p-2">When</th>
          <th className="p-2">Cups</th>
          <th className="p-2"></th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((j) => (
          <tr key={j.id} className="border-b">
            <td className="p-2 font-mono">{j.sticker_number}</td>
            <td className="p-2">{j.source}</td>
            <td className="p-2">
              <span className={
                j.status === "printed" ? "text-green-700"
                : j.status === "failed" ? "text-red-700"
                : j.status === "stale" ? "text-gray-500" : "text-amber-700"
              }>
                {j.status}{j.attempts > 0 ? ` (${j.attempts}x)` : ""}
              </span>
              {j.last_error ? <div className="text-xs text-red-600">{j.last_error}</div> : null}
            </td>
            <td className="p-2">{new Date(j.created_at).toLocaleString("en-AU", { timeZone: "Australia/Brisbane" })}</td>
            <td className="p-2">{j.cups.map((c) => c.drinkName).join(", ")}</td>
            <td className="p-2">
              <button
                disabled={busyId === j.id}
                onClick={() => reprint(j.id)}
                className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
              >
                {busyId === j.id ? "..." : "Reprint"}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/prints/page.tsx src/app/admin/prints/table.tsx
git commit -m "feat(admin): /admin/prints page with stats + device health + reprint"
```

### Task 8.3: Remote reprint endpoint

**Files:**
- Create: `src/app/api/admin/prints/reprint/route.ts`

- [ ] **Step 1: Write the endpoint**

```ts
// src/app/api/admin/prints/reprint/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

async function assertOwner(): Promise<string | null> {
  const cookieStore = await cookies();
  const ssr = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) return null;
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("admin_users")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  return data ? user.id : null;
}

export async function POST(request: Request) {
  const userId = await assertOwner();
  if (!userId) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { id?: string };
  if (!body.id) return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: orig, error: origErr } = await admin
    .from("print_jobs")
    .select("*")
    .eq("id", body.id)
    .maybeSingle();
  if (origErr || !orig) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  const synthetic = `reprint:${orig.square_order_id}:${new Date().toISOString()}`;
  const { data: cloned, error: cloneErr } = await admin
    .from("print_jobs")
    .insert({
      square_order_id: synthetic,
      source: orig.source,
      sticker_number: orig.sticker_number,
      order_total_cents: orig.order_total_cents,
      cups: orig.cups,
      status: "pending",
    })
    .select()
    .single();
  if (cloneErr) return NextResponse.json({ ok: false, error: cloneErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, clonedId: cloned.id });
}
```

- [ ] **Step 2: Type-check**

```bash
cd ~/Github/mandys_bubble_tea
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/prints/reprint/route.ts
git commit -m "feat(admin): /api/admin/prints/reprint endpoint (owner-gated clone)"
```

### Task 8.4: Manual verification

- [ ] **Step 1: Deploy to Vercel**

```bash
git push origin main
```
Wait for Vercel to finish building.

- [ ] **Step 2: Sign in as owner**

In a browser, go to `https://mandybubbletea.com` and sign in with the owner account (whose user_id was seeded into `admin_users` in Task 1.3).

- [ ] **Step 3: Navigate to /admin/prints**

Go to `https://mandybubbletea.com/admin/prints`. Expected:
- Four stat tiles (Pending / Printed / Failed / Stale).
- Device row showing `mac-mini-store-davenport` with recent heartbeat (green if < 2 min).
- Job list table with recent jobs.

- [ ] **Step 4: Trigger a remote reprint**

Click "Reprint" on any printed job. Confirm the dialog. Within ~3 seconds a sticker should print on the Mac mini. The page reloads; new cloned row appears with `square_order_id` starting `reprint:`.

- [ ] **Step 5: Verify non-owner blocked**

Sign out, sign in as a non-owner test user, and try to visit `/admin/prints` — expected: 404 (not found, to avoid leaking the route's existence).

---

## Phase 9 — Production rollout

### Task 9.1: Add order.updated webhook event in Square

- [ ] **Step 1: Open Square Developer Dashboard → Webhooks**

For your production application, open the existing webhook subscription used by `customer.deleted` and `order.fulfillment.updated`.

- [ ] **Step 2: Add `order.updated` to the event list**

Check the box for `order.updated` (in the Orders event group). Save.

- [ ] **Step 3: Verify signature still valid**

Place one small sandbox-paid test order (or use Square's "Send Test Webhook" feature). Check Vercel logs for `[print] queued order ...`. Verify the row in `print_jobs`. Verify a sticker prints on the Mac mini.

### Task 9.2: Update modifier list IDs

- [ ] **Step 1: Get real IDs from Square Dashboard**

In Square Dashboard → Items & orders → Modifiers, copy the ID of each modifier list (Topping / Ice / Sugar).

- [ ] **Step 2: Update `src/lib/modifier-buckets.ts`**

Replace the `REPLACE_ME_*` placeholder keys with the real IDs. Remove the `TODO(pre-launch)` comment.

- [ ] **Step 3: Commit and deploy**

```bash
cd ~/Github/mandys_bubble_tea
git add src/lib/modifier-buckets.ts
git commit -m "chore(sticker): fill in production modifier list IDs"
git push origin main
```

- [ ] **Step 4: Verify with a real order**

Place one real-catalog order (web or POS). Inspect the `print_jobs.cups` row in Supabase: the modifier chosen should land in the correct bucket (`toppings`/`ice`/`sugar`), not all in `toppings`.

### Task 9.3: 24-hour burn-in checklist

- [ ] **Step 1: Day-zero pre-flight**

- `launchctl list | grep mandysbubbletea` shows a PID
- `lpstat -p Zebra_ZD411` shows `idle`
- `https://mandybubbletea.com/admin/prints` shows green heartbeat
- One test-print sticker prints cleanly

- [ ] **Step 2: During business hours**

- Spot-check 5 real orders: each produces N stickers (one per cup), each correctly labeled.
- Verify a web order sticker shows `OL<n>` matching the customer's confirmation page.
- Verify a POS order sticker shows `TA<nn>`.
- Verify modifier slots are populated correctly (topping/ice/sugar in the right places).

- [ ] **Step 3: Post-close review**

- In Supabase: `select count(*), status from print_jobs where created_at::date = current_date group by status;`
- Expected: `printed` dominates; `failed` near zero; `stale` zero.
- If any `failed` rows exist, read `last_error`; file follow-ups.

- [ ] **Step 4: Commit a "launched" marker (optional)**

```bash
cd ~/Github/mandys_bubble_tea
git tag -a cup-sticker-print-v1 -m "Cup sticker auto-print system live $(date -u +%Y-%m-%dT%H:%MZ)"
git push origin cup-sticker-print-v1
```

---

## Done

The system is live: Square payment → Vercel webhook → Supabase `print_jobs` → Mac mini Realtime → Zebra ZD411 via CUPS, with owner push alerts, local + remote ops UIs, and launchd supervision.
