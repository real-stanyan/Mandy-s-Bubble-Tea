# Cup Sticker Auto-Print System

Date: 2026-04-22
Status: Design approved, pending implementation plan

## Goal

Auto-print bubble tea cup stickers (order #, drink name, modifiers, cup index, price) on a Zebra ZD411 in-store as soon as an order is paid, for BOTH online (mandybubbletea.com) and in-store Square POS orders. Replaces the manual sticker workflow that Square POS doesn't natively support.

## Scope

- **In scope**: all paid Square orders at the `34 Davenport St, Southport` location (web + POS); one sticker per cup; English-only content; Mac mini in-store as the local controller; USB-connected Zebra ZD411.
- **Out of scope (for now)**: multi-location, Chinese rendering, Ethernet-mode printer, PWA kitchen display, analytics dashboards beyond queue status.

## Architecture

```
 Square (POS + Web)
     │  order.updated (payment COMPLETED, first time)
     ▼
 Vercel /api/webhooks/square        (extends existing handler)
   └─ INSERT ON CONFLICT DO NOTHING ─▶ Supabase print_jobs
                                                │ Realtime (postgres_changes INSERT)
                                                ▼
                                       Mac mini printer-client/
                                         ├─ launchd-managed Node service
                                         ├─ Supabase Realtime subscriber
                                         ├─ ZPL renderer
                                         ├─ lp -o raw → CUPS → USB → Zebra ZD411
                                         └─ localhost:3001 employee UI

 Side channels:
   - mandybubbletea.com/admin/prints  (owner: remote monitoring + reprint)
   - /api/admin/print-alert → Expo push to owner (alert path)
   - printer_heartbeats table (Mac mini upserts every 30s)
```

**Key invariant:** the Supabase `print_jobs` INSERT is the only trigger for printing. Mac mini never talks to Square directly; Vercel never talks to the printer directly. This decouples webhook delivery from printer availability.

## Trigger

Fires on `order.updated` when payment first transitions to `COMPLETED`. Implementation relies on the `unique(square_order_id)` constraint on `print_jobs`: all qualifying `order.updated` events attempt an INSERT; conflicts silently no-op. An event qualifies when the fetched Square order has:

- At least one completed tender (`order.tenders.length > 0`), AND
- `order.totalMoney.amount > 0`.

This guarantees:

- Unpaid `order.created` events never print (avoids the "barista sees a sticker for an order that was abandoned at checkout" problem).
- Re-printing on later `order.updated` (e.g., pickup-ready, refund) is impossible.

## Order number encoding

Two schemes, chosen by order source to match what the customer sees and what fits the sticker:

### Online (`OL`)

Use the existing daily-reset counter (`nextOnlineOrderNumber()` → `OL800`, `OL801`, ...). Plain 3-digit format, no compression. 200 numbers/day is enough headroom. If web traffic ever exceeds that, revisit — not a Day 1 concern.

### In-store POS (`TA`)

A new Supabase daily counter with compact compression:

- Core: `TA` + `(n % 100)` zero-padded 2 digits.
- Hundreds place: `*` per hundred (max 9 stars = 900).
- Thousands place: `$` per thousand (each `$` = 10 stars).
- Symbols appear after the digits, `$`s before `*`s (larger place first).

Examples:

| n    | Sticker    |
| ---- | ---------- |
| 47   | `TA47`     |
| 147  | `TA47*`    |
| 947  | `TA47*********` |
| 1047 | `TA47$`    |
| 1247 | `TA47$**`  |
| 2347 | `TA47$$***` |

Rationale: baristas scan the 2-digit core (the most frequent signal) and count symbols only for large numbers. The symbol count is proportional to how long ago the order was placed, useful operationally.

### Why separate schemes

Customers on `/order-confirmation` see `OL812`. They need to match that against the cup sticker during pickup. Forcing `OL812` into the 2-digit-core form would require either changing the confirmation page or creating a mismatch. `TA` has no customer-facing equivalent, so compression is free.

### Source detection

- Web: `order.metadata.source === 'web'` (set in `src/app/api/orders/route.ts:225`). Use `order.ticketName` directly as sticker number.
- POS: anything else. Call `next_store_order_number()` RPC, encode via `encodeStoreStickerNumber`.

## Data model

### `print_jobs`

```sql
create table public.print_jobs (
  id                uuid primary key default gen_random_uuid(),
  square_order_id   text not null unique,
  source            text not null check (source in ('web', 'pos')),
  sticker_number    text not null,
  order_total_cents integer not null,
  cups              jsonb not null,  -- expanded array, one entry per physical cup
  status            text not null default 'pending'
                     check (status in ('pending', 'printed', 'failed', 'stale')),
  attempts          integer not null default 0,
  last_error        text,
  created_at        timestamptz not null default now(),
  printed_at        timestamptz
);

create index on print_jobs (status, created_at);
alter table print_jobs enable row level security;
-- service_role: all operations (used by both Vercel webhook + Mac mini client)
-- authed admin: select/update via /admin/prints (gated by admin_users table)
```

`cups` jsonb shape:

```json
[
  {
    "drinkName": "Brown Sugar Milk Tea",
    "toppings": ["Pearls", "Grass Jelly"],
    "ice": "Less Ice",
    "sugar": "Half Sugar",
    "priceCents": 700
  },
  ...
]
```

Rationale for jsonb over a relational child table: each job is one atomic print unit. The Mac mini loops over `cups` to emit N ZPL labels. Never queried in isolation; keeping it embedded avoids join complexity.

### `store_order_counters` (for TA numbering)

```sql
create table public.store_order_counters (
  day    date primary key,  -- Australia/Brisbane local day
  last_n integer not null default 0
);

create function public.next_store_order_number()
returns integer language plpgsql as $$
declare today date := (current_timestamp at time zone 'Australia/Brisbane')::date;
declare v int;
begin
  insert into store_order_counters (day) values (today)
    on conflict (day) do nothing;
  update store_order_counters set last_n = last_n + 1 where day = today
    returning last_n into v;
  return v;
end; $$;
```

### `printer_heartbeats`

```sql
create table public.printer_heartbeats (
  device_id      text primary key,           -- e.g., 'mac-mini-store-davenport'
  last_seen_at   timestamptz not null,
  printer_status text,                       -- 'idle' | 'printing' | 'offline'
  pending_count  integer
);
```

Mac mini upserts every 30s. `/admin/prints` reads this to show "last seen" + status.

### `admin_users`

```sql
create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role    text not null check (role in ('owner'))
);
```

MVP: INSERT the owner's Supabase user_id once manually. `/admin/prints` checks this.

## Vercel webhook extension

Add a third branch in `src/app/api/webhooks/square/route.ts` (alongside `customer.deleted` and `order.fulfillment.updated`).

```
if (event.type === 'order.updated') {
  const orderId = pickUpdatedOrderId(event);        // event.data.object.order_updated.order_id
  if (orderId) await handleOrderPaid(orderId);
}
```

`handleOrderPaid(orderId)`:

1. `squareClient.orders.get({ orderId })`
2. If `tenders.length === 0` or `totalMoney.amount <= 0`, return (not yet paid).
3. Detect source:
   - `order.metadata?.source === 'web'` → use `order.ticketName` as sticker number, `source = 'web'`.
   - Otherwise → `next_store_order_number()` RPC → `encodeStoreStickerNumber(n)`, `source = 'pos'`.
4. Expand line items into `cups[]`: for each line, repeat `quantity` times; bucket modifiers by looking up `modifierListId` against a new `src/lib/modifier-buckets.ts` constant table (topping / ice / sugar). Unrecognised modifier lists go into the topping bucket as a safety fallback.
5. `INSERT INTO print_jobs (..., status='pending') ON CONFLICT (square_order_id) DO NOTHING`.
6. Always return 2xx to Square (consistent with current handler style).

**modifier-buckets.ts requires Square Dashboard configuration**: each Square modifier list has an id (Topping List, Ice Level, Sugar Level). These ids must be copied into `modifier-buckets.ts` once. Future modifier lists require updating this file. Documented in `printer-client/README.md`.

## ZPL sticker layout (50mm × 30mm, 203 dpi → 400 × 240 dots)

Four logical rows:

```
┌───────────────────────────────────────┐
│ OL812              21:35              │   order number + time
│ Brown Sugar Milk Tea                  │   drink name (wrap if long)
│ Pearls+Jelly -> Less Ice -> Half Sugar│   toppings -> ice -> sugar
│ 1/2                            $7.00  │   cup index / total, price
└───────────────────────────────────────┘
```

**Details:**

- Font: Zebra built-in font 0 (scalable), sizes around 30/24/20/22 dots respectively. Exact dot sizes tuned during Phase 2.
- Separator: literal ASCII `->` (ZPL built-in fonts have no `→`; visually equivalent). Reserved across all stickers.
- Three modifier slots are fixed in position. Empty slot renders as blank space between `->`s (no placeholder dash) for a cleaner look.
- Multiple toppings join with `+`: `Pearls+Jelly -> ...`.
- `^FB` (field block) used for auto-wrap of drink names and modifier lines.
- Price rendered as `$X.YY` from `priceCents`.

**Rendering function lives at `printer-client/src/zpl.ts`:**

```ts
renderStickerZPL(cup: {
  stickerNumber: string;
  orderTime: string;         // 'HH:mm' Australia/Brisbane
  drinkName: string;
  toppings: string[];
  ice: string | null;
  sugar: string | null;
  cupIndex: number;          // 1-based
  cupTotal: number;
  priceCents: number;
}): string
```

Pre-production validation via labelary.com/viewer.html (ZPL → visual preview, no physical printer needed).

## Printer client — `printer-client/` layout

```
printer-client/
├── package.json            # independent deps: @supabase/supabase-js, express
├── tsconfig.json
├── .env.local.example
├── src/
│   ├── index.ts            # entry: start subscriber + UI + heartbeat
│   ├── supabase.ts         # service_role client
│   ├── printer.ts          # lp -d Zebra_ZD411 -o raw (CUPS)
│   ├── zpl.ts              # renderStickerZPL
│   ├── queue.ts            # Realtime subscribe + replay + state transitions
│   ├── alert.ts            # POST to /api/admin/print-alert on failure
│   ├── heartbeat.ts        # upsert printer_heartbeats every 30s
│   └── ui/
│       ├── server.ts       # Express routes
│       └── public/         # index.html + vanilla JS
├── scripts/
│   └── test-print.sh       # smoke test
└── launchd/
    └── com.mandysbubbletea.printer.plist
```

### USB path: CUPS, not node-usb

Mac mini prints via CUPS (`lp -d Zebra_ZD411 -o raw`), spawning a subprocess and piping the ZPL string to stdin. Rationale:

- macOS native; integrates with "System Settings → Printers & Scanners" for setup and status queries (`lpstat -p Zebra_ZD411`).
- Survives macOS updates and user logout. `node-usb` / libusb requires disabling the default CUPS claim on the USB endpoint, which is fragile on user upgrade.
- Failure mode is clean: `lp` exits non-zero, we catch it and transition the job to `failed`.

### Startup replay + state machine

```
on start:
  1. UPDATE print_jobs SET status='stale'
       WHERE status='pending' AND created_at < now() - 10 minutes
     (Orders >10min old are past the point where a late sticker helps; these
      require manual reprint from an operator UI.)
  2. SELECT * FROM print_jobs WHERE status='pending' ORDER BY created_at
     Loop handleJob on each.

on Realtime INSERT event:
  handleJob(row)

handleJob(job):
  for each cup in job.cups:
    renderStickerZPL -> printZPL
  if all succeed:
    UPDATE status='printed', printed_at=now()
  on any error:
    UPDATE status='failed', attempts=attempts+1, last_error=...
    if attempts >= 3: alert()
```

### Alerts

Two independent triggers:

1. `handleJob` failure when resulting `attempts >= 3`: immediate alert.
2. A 30s interval timer on Mac mini: if `min(created_at) WHERE status='pending'` is older than 2 minutes, alert.

Alert delivery: POST `https://mandybubbletea.com/api/admin/print-alert` (new endpoint), which calls `sendExpoPush` targeting all `admin_users.role='owner'` device tokens. Reuses the existing Expo push infrastructure (`src/lib/push.ts`). Alert deduped client-side by Mac mini (don't re-send same error within 5 min).

**Alert endpoint auth**: new shared secret `PRINTER_ALERT_TOKEN` env var on both sides; Mac mini sends `Authorization: Bearer <token>`, Vercel endpoint rejects without it. Prevents arbitrary internet POSTs from spamming push notifications.

### launchd

`~/Library/LaunchAgents/com.mandysbubbletea.printer.plist`:
- `RunAtLoad=true`
- `KeepAlive=true` (respawns on crash)
- Logs → `~/Library/Logs/mandys-printer.log` (rotated weekly via `newsyslog.d`)

## Operational UIs

### Local (Mac mini) — `http://localhost:3001`

Audience: employees. No login (only accessible from the machine itself). Features in priority order:

1. Last 20 print jobs (sticker#, time, drink, status icon).
2. Reprint button per row (see Reprint semantics below).
3. Test print button (fixed "TEST" sticker, validates lp → USB → Zebra link).
4. Status indicator: printer (via `lpstat -p`) + Supabase connection.
5. Stale queue (collapsed): recent `status='stale'` rows with manual reprint.

Tech: Express in-process, single HTML + vanilla JS + fetch. No React, no build step.

### Remote — `mandybubbletea.com/admin/prints`

Audience: owner. Features:

1. Today's stats (printed / failed / pending counts).
2. Printer heartbeat (last seen, status).
3. Last 100 jobs (searchable by sticker# / drink name).
4. Reprint button (see Reprint semantics below).
5. Recent alerts (7-day window).

### Reprint semantics (unified across both UIs)

Both local and remote reprint always INSERT a cloned `print_jobs` row (new id, same `cups`, `status='pending'`, `printed_at=null`). The new row carries `square_order_id = 'reprint:<orig_order_id>:<iso_timestamp>'` to avoid the `unique(square_order_id)` conflict while preserving an audit trail (the prefix is never produced by the Vercel webhook, so there's no collision risk). The normal Realtime flow then delivers it to Mac mini and prints. This approach:

- Keeps the audit log complete (every sticker ever printed has its own row).
- Lets the same code path handle reprint originating from any UI.
- Makes "remote reprint while Mac mini offline" work correctly via `replayOnStart` once the Mac mini reconnects — provided the reprint happened within the 10-minute window.

Routes: `src/app/admin/layout.tsx` (admin_users gate) + `src/app/admin/prints/page.tsx`.

## Error handling matrix

| Failure | Symptom | Handling |
| --- | --- | --- |
| Vercel `orders.get` fails | Can't build job | log error, webhook still returns 2xx so Square stops retrying; order skipped (manual reprint from Dashboard if caught) |
| INSERT conflict | Duplicate order | silent skip (idempotent) |
| Mac mini offline (network) | No Realtime delivery | `replayOnStart` on reconnect processes 10min window; older → `stale` |
| `lp` command fails | Printer offline / out of paper / USB disconnected | status → `failed`, `attempts++`; alert at 3 |
| Supabase outage | Realtime dead | heartbeat table stops updating; `/admin/prints` shows `last_seen_at` > 2min → shown red |
| Mac mini crash | Process dead | launchd restarts within ~10s |

## Testing strategy

**Unit:**
- `encodeStoreStickerNumber`: table-driven (0, 99, 100, 999, 1000, 1234, 9999).
- Modifier bucket resolver: cover all known list ids + unknown-list fallback.
- ZPL renderer: snapshot tests; boundaries = long drink name, 5 toppings, missing ice, price with cents.

**Integration:**
- Local Supabase + ngrok: `scripts/sign-webhook-local.ts` (already exists, see commit `e64f03f`) posts synthetic `order.updated` → verify `print_jobs` row shape.
- `scripts/seed-fake-job.ts`: INSERT a test row, observe Mac mini prints correctly.

**E2E (pre-launch):**
- Square sandbox order → real Vercel webhook → real Supabase → Mac mini → real sticker printed.

## Milestones

| Phase | Scope | Acceptance |
| --- | --- | --- |
| **1. MVP (2-3 days)** | `print_jobs` table + Vercel webhook branch + minimal Mac mini client (CUPS + Realtime + no UI) | Sandbox order → English sticker printed |
| **2. Hardening (2 days)** | ZPL polish (auto-wrap + `+` for multi-topping) + `replayOnStart` + launchd + heartbeat table | USB unplugged 10s → reconnect, no lost orders; Mac mini reboots autonomously |
| **3. Ops surfaces (2 days)** | Mac mini `localhost:3001` + `/admin/prints` + alert push | Owner gets push on queue backup; employees can self-serve reprint |
| **4. Launch (0.5 day)** | Production webhook subscription + real Mac mini install + 24h burn-in | One day of real orders: 0 missed prints, 0 duplicates |

## Environment / config

**Vercel** (reuses existing + one new):
- `SUPABASE_SERVICE_ROLE_KEY` (existing)
- `SQUARE_WEBHOOK_SIGNATURE_KEY` (existing)
- `SQUARE_ACCESS_TOKEN` (existing)
- `PRINTER_ALERT_TOKEN` (new — shared secret for the alert endpoint)

**`printer-client/.env.local`** (new):
```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
PRINTER_NAME=Zebra_ZD411
DEVICE_ID=mac-mini-store-davenport
ADMIN_ALERT_ENDPOINT=https://mandybubbletea.com/api/admin/print-alert
PRINTER_ALERT_TOKEN=...  # must match Vercel env var
```

**Square Dashboard**:
- New webhook event subscription: `order.updated` (existing `customer.deleted` + `order.fulfillment.updated` remain).

## Open questions / risks

1. **Text fit at 50×30 mm**: The `^FB` auto-wrap limits for a long drink name + 3 toppings at chosen font sizes are unverified. Phase 2 tunes exact dot sizes against printed samples. Worst case: drop drink-name size one notch.
2. **Modifier list id drift**: Adding a new modifier list in Square Dashboard requires updating `modifier-buckets.ts`. Documented in README; no automated detection.
3. **POS order metadata assumption**: The design assumes POS orders lack `metadata.source='web'`. Must be verified with one real POS order during Phase 1 E2E.
4. **Split-tender / partial payment edge case**: Rare. `unique(square_order_id)` prints once at first completion event. If second payment arrives later (split bill), no re-print. Acceptable — 0.1% of real traffic.
