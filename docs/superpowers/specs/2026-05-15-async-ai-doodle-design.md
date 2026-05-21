# Async AI Doodle — Submit-and-Forget + 1×/slot Quota

**Date:** 2026-05-15
**Repos:** `mandys_bubble_tea` (web + printer-client) · `mandys_bubble_tea_app` (RN)
**Branch:** continue on `feat/cup-label-zebra-zd410` (rides with PR #9 ZD410 cutover)

## Why

The current `/api/cup-label/ai-generate` route is synchronous: customers
wait 15-40 s on a spinner watching Doubao Seedream produce their image,
and can re-submit unlimited times before checkout. Two problems:

1. **Cost** — Every Doubao call costs money. A customer toying with
   prompts can burn 5-10 calls per cup, multiplied across cups and
   customers. No upper bound today.
2. **UX** — Watching a spinner mid-checkout for half a minute is not
   the bubble-tea ordering experience.

## Goals

- Hard cap: **one Doubao call per cup slot, per customer**. Submitting
  for the same `{clientLineId}:{cupIdx}` slot a second time returns the
  existing job (idempotent), never re-charges.
- Client-side wait time: **0 s**. Submit closes the modal immediately.
- Print-time wait: server-side `loadAiDoodleUpload` polls the row up
  to 30 s. Customers physically receiving their drink wait at least
  that long anyway — so the AI almost always lands in time. If it
  doesn't, fall back to the hash POOL preset (existing behaviour).
- "Surprise on your cup" UX — customer never sees a preview. The image
  is revealed on the printed label.

## Non-goals

- Preview before pickup (rejected: doubles UI work, weakens cost cap
  by inviting "I don't like it, try again" pressure).
- Cross-order quota (rejected: a returning customer shouldn't be
  locked out the next day).
- Failure retry (failed Doubao call → that slot's row is final, the
  enqueue's fallback to hash POOL kicks in. Customer doesn't see the
  failure; they just get a normal doodle).

## Schema

New table `cup_label_ai_jobs`:

```
id              uuid primary key default gen_random_uuid()
user_id         uuid not null
slot_key        text not null   -- "{clientLineId}:{cupIdx}"
prompt          text not null
status          text not null check (status in ('pending','ready','failed'))
png_path        text            -- storage path once ready
error           text            -- doubao / binarize / upload error
created_at      timestamptz not null default now()
ready_at        timestamptz

unique (user_id, slot_key)      -- quota enforcement at the DB level
```

RLS service-role-only (no client policies; only our routes read/write
it via supabase admin client).

## Endpoint flow

**POST `/api/cup-label/ai-submit`** (replaces `/api/cup-label/ai-generate`)

Body: `{ slotKey: string, prompt: string, sourceImageBase64?: string }`

```
1. requireUser()
2. lookup row WHERE user_id=$1 AND slot_key=$2
   - if found: return { aiDoodleId: row.id } (idempotent — quota hit)
3. insert row status='pending'
4. waitUntil(processAiJob(row.id))   -- Vercel Pro 90s background
5. return { aiDoodleId } immediately
```

**`processAiJob(jobId)`** (background, no HTTP response):

```
- decode + upload sourceImage if any
- call Doubao /images/generations
- download upstream PNG
- binarizeForThermal({ mode: 'atkinson' })
- upload to doodles_pending bucket at {userId}/ai/{aiDoodleId}.png
- UPDATE cup_label_ai_jobs SET status='ready', png_path, ready_at=now()
- on any failure: UPDATE status='failed', error=<message>
```

**`loadAiDoodleUpload(userId, aiDoodleId)`** in `lib/doodle/upload-store.ts`
gains polling:

```
- query cup_label_ai_jobs row
- if status='ready': download PNG from storage
- if status='pending': poll every 1s,2s,4s,8s,15s (capped 30s)
- if status='failed' or timeout: throw — enqueue.ts catches + falls
  back to hash POOL preset
```

## Client UX (RN + Web)

DoodleModal AI tab:

- "Generate" button → renamed "Submit"
- On Submit success: modal closes immediately, no spinner, no preview
- Disabled state when slot already has an aiDoodleId (re-opening the
  modal for that cup shows "Already submitted ✓" instead of the input)
- Cup card in DoodleSection: when slot has aiDoodleId, show
  "✨ Surprise on your cup" placeholder with sparkle icon, not the
  current thumbnail strip

Web mirrors RN.

## Migration

`supabase/migrations/2026-05-15-cup-label-ai-jobs.sql`:

```sql
create table cup_label_ai_jobs (
  ...as above...
);
create index cup_label_ai_jobs_status_idx
  on cup_label_ai_jobs (status, created_at)
  where status = 'pending';
alter table cup_label_ai_jobs enable row level security;
```

## Compat / Rollout

- The existing `/api/cup-label/ai-generate` route is removed. Live web
  + app code currently calls it — but this change rides PR #9 (cup-label
  cutover) and the App PR #1 ships in lockstep, so no live customer
  sees a half-finished pipeline.
- Old `aiDoodleId`s point to existing storage uploads. The new code
  also reads from `cup_label_ai_jobs`. For backwards compat, the
  loader first looks for a `cup_label_ai_jobs` row by id; if missing,
  falls back to the legacy "blob exists at path" check (existing
  behaviour). Old IDs keep working until the table garbage-collects
  rows >30d old.

## Files touched (estimate)

```
NEW supabase/migrations/2026-05-15-cup-label-ai-jobs.sql
NEW src/lib/cup-label/ai-process.ts                  (Doubao + binarize + upload)
NEW src/app/api/cup-label/ai-submit/route.ts         (replaces ai-generate)
DEL src/app/api/cup-label/ai-generate/route.ts
MOD src/lib/doodle/upload-store.ts                   (loadAiDoodleUpload polls)
MOD src/lib/cup-label/enqueue.ts                     (slot_key derivation)
MOD components/doodle/DoodleModal.tsx (RN)           (submit-and-close UX)
MOD components/doodle/DoodleSection.tsx (RN)         ("Surprise" placeholder)
MOD app/checkout related (web)                       (mirror RN UX)
NEW src/lib/cup-label/ai-process.test.ts
NEW src/lib/cup-label/ai-submit.test.ts (optional)
```

Estimated effort: 6-8 hours.

## Open questions (resolved)

- ✅ Preview? **No** — Surprise mode.
- ✅ Quota scope? **Per cup slot**, idempotent re-submit.
- ⚠️ What if the customer changes the cart between submit and
  checkout (deletes the cup, changes a modifier so clientLineId
  shifts)? Resolution: the orphan `cup_label_ai_jobs` row stays in DB
  but is never referenced by any cup; daily cleanup cron drops rows
  >30d old. Future enhancement: cleanup on cart-change client-side.
