# Checkout Keepsake Cup Label — Design

**Date:** 2026-06-09
**Repos:** `mandys_bubble_tea` (web) + `mandys_bubble_tea_admin` (gallery filter)
**Status:** Approved design → ready for implementation plan

## Problem

At checkout, customers who customize their cup label (drawn / AI / photo / gallery
sticker) have no way to keep a copy — the only printed label goes onto the cup and
is handed off with the drink. Stan wants an opt-in: a checkout toggle that, when on,
makes the printer produce **one extra copy of each customized cup's label** so staff
can hand the spare to the customer to keep.

## Decisions (locked with Stan)

1. **Scope of extra copies:** only cups the customer *actually customized*
   (drawn / AI / photo / gallery sticker). Cups that fell back to a random tarot card
   (no choice) get **no** extra copy. One extra copy per customized cup.
2. **Price:** free. No money/payment/loyalty impact.
3. **Extra-copy content:** same as the cup label **minus drink name and minus
   modifiers (toppings/sugar/ice)**. Keeps: `Hi, {name}` greeting, `OLxxx · idx/M`
   order number + cup fraction, the artwork, Mandy logo, top/bottom dividers.
4. **Toggle visibility:** the checkout toggle shows **only when the order has at least
   one customized cup**. Tarot-only orders never see it.
5. **Storage keying:** Approach A — add a `copy_idx` column and extend the unique
   constraint. Primary rows stay `copy_idx = 0` (behavior unchanged); keepsake copies
   are `copy_idx = 1`.
6. **Admin gallery:** filter the cup-doodles gallery to `copy_idx = 0` so keepsake
   copies don't double-list. Done in the same change (cross-repo).
7. **Platform:** web only for now. The RN app and POS webhook do not send the flag and
   therefore produce no keepsakes (absent flag = off).

## Architecture

The existing cup-label pipeline is unchanged in shape:

```
checkout → /api/payment (body) → enqueueCupLabelJobs() → cup_label_jobs rows
                                                            → printer-client prints each INSERT
```

Keepsakes ride the same rails: they are extra `cup_label_jobs` rows, inserted in the
same authoritative enqueue call, printed by the same printer-client subscription. The
only new concepts are (a) a per-order opt-in flag, (b) a `copy_idx` discriminator on
the row, and (c) a `keepsake` render variant.

### Why keepsakes are race-free

`enqueueCupLabelJobs` runs from the **payment route's authoritative branch** (the one
that carries the user's choices, deferred via `after()`). The Square webhook default
path and the safety-net backfill never carry `includeKeepsakeCopies`, so they never
emit keepsakes. Even if the authoritative enqueue runs twice, keepsake rows dedupe on
the extended unique constraint (`…, copy_idx`). No new race surface vs the existing
INSERT/UPDATE conflict handling.

## Components

### 1. Schema migration (web)

New migration `supabase/migrations/2026-06-09-cup-label-keepsake-copy-idx.sql`:

- `alter table cup_label_jobs add column copy_idx int not null default 0;`
- Drop the existing 3-column unique constraint
  (`cup_label_jobs_square_order_id_line_id_cup_idx_key`, use `drop constraint if exists`)
  and add `unique (square_order_id, line_id, cup_idx, copy_idx)`.

Existing rows backfill to `copy_idx = 0` via the default. `claim_oldest_cup_label_job`
is unaffected (it claims any pending row regardless of `copy_idx`).

**Implementation note:** the old 3-column unique constraint MUST be dropped — if it
survives, keepsake rows (same 3 columns, `copy_idx` differs) violate it. The auto name
is expected to be `cup_label_jobs_square_order_id_line_id_cup_idx_key`, but the plan
must confirm the actual name first (`select conname from pg_constraint where conrelid =
'cup_label_jobs'::regclass and contype = 'u'`) and drop that exact name, not rely on a
guess + `if exists` silently skipping.

### 2. Renderer — `src/lib/cup-label/render-zebra-cup.ts`

Add `keepsake?: boolean` to `CupLabelInput`. When `true`:

- `buildZpl`: skip the drink-name field and the modifier field in the bottom band.
  Keep the top black band (greeting + sticker·fraction), the doodle `^GFA`, the bottom
  divider `^GB`, and the Mandy logo.
- `renderBottomBandPng` (dev preview): skip the drink + modifier `<text>` blocks; keep
  divider + logo so the preview matches.

Pure additive — every existing caller omits the flag and renders exactly as today. The
keepsake bottom band is mostly whitespace by design (that's the "keep everything except
drink + mods" requirement).

### 3. Enqueue — `src/lib/cup-label/enqueue.ts`

Add `includeKeepsakeCopies?: boolean` to `EnqueueCupLabelArgs`.

Per cup, track a local `keepsakeEligible` boolean. Set it **true only in the three live
custom-source branches**, after a successful load:

- `presetStickerHash` branch (gallery sticker) → true
- `aiDoodleId` branch (AI **and** photo upload — both land here) → true
- `userDoodleId` branch (drawn) → true

Leave it **false** for: POS mode, the tarot/POOL fallback else-branch, and any branch
that catches an error and calls `useDefaultFallback()`. This precisely matches decision
#1 (only genuinely-customized cups, never a fallback).

After pushing the primary row, if `includeKeepsakeCopies && keepsakeEligible`:

- Render a second label reusing the **same** `doodleSvg` / `doodlePngBuffer`,
  `stickerNumber`, `cupIdxOf`, and `customerFirstName`, with `keepsake: true` and
  `drinkName`/`modifiersText` passed but ignored by the renderer.
- Push a second `Row` with `copy_idx: 1`, `original_image_path: null`,
  `ai_job_id: null` (so it never enters the admin gallery), same `square_order_id` /
  `line_id` / `cup_idx` / `sticker_number` / `doodle_source` / `doodle_pool_key` /
  `doodle_paths` as the primary.

Primary rows are written with `copy_idx: 0` (explicit). Update the upsert
`onConflict` string to `"square_order_id,line_id,cup_idx,copy_idx"` to match the new
constraint; `ignoreDuplicates` logic is unchanged. Keepsake rows are appended to the
same `rows[]` array and upserted in the same call.

### 4. Payment route — `src/app/api/payment/route.ts`

Read `body.keepLabelCopy` (boolean, optional). Pass
`includeKeepsakeCopies: body.keepLabelCopy === true` into **both** `enqueueArgs`
objects (the paid branch ~L246 and the $0-loyalty branch ~L305). No other route logic
changes.

### 5. Payment request body type

Add optional `keepLabelCopy?: boolean` to the payment request body schema/type
(wherever `doodleIds` / `presetStickerHashes` are declared on the body). Absent →
treated as `false`.

### 6. Checkout UI — `src/app/checkout/page.tsx`

- Compute `hasAnyCustomizedCup` from `labelSelections` by reusing
  `buildPaymentSelections(labelSelections)` — true iff any of the three returned maps
  is defined (exactly mirrors server eligibility, including the in-flight `null`-id
  skip).
- When `hasAnyCustomizedCup`, render a toggle (checkbox) near the cup-label / order
  summary area:
  > 🎁 Print an extra copy of my custom cup design to keep
- Toggle state lives in the cart store as `keepLabelCopy: boolean` (default `false`),
  alongside `labelSelections`, so it persists across navigation and `clear()` resets
  it. Include it in the `/api/payment` request body as `keepLabelCopy`.
- If the order has no customized cups, the toggle is not rendered and the flag stays
  `false`.

### 7. Cart store — `src/store/cart.ts`

Add `keepLabelCopy: boolean` (default `false`), a `setKeepLabelCopy(v)` action, reset
to `false` in `clear()`, and include it in the persisted slice.

### 8. Admin gallery filter — `mandys_bubble_tea_admin`

In the cup-doodles gallery data query (`src/lib/cup-doodles.ts` / its Supabase read),
add `.eq("copy_idx", 0)` (or `coalesce(copy_idx,0)=0`) so keepsake copies never appear
as duplicate tiles. Drawn keepsakes would otherwise show (their primary rows have null
`original_image_path` too, so an `original_image_path`-based filter is insufficient).

## Data flow (happy path)

1. Customer customizes ≥1 cup → `labelSelections` populated.
2. Checkout shows the 🎁 toggle; customer turns it on → `keepLabelCopy = true` in cart.
3. Pay → `/api/payment` body includes `keepLabelCopy: true` + the choice maps.
4. Authoritative `after()` enqueue runs with `includeKeepsakeCopies: true`.
5. For each customized cup: one primary row (`copy_idx 0`) + one keepsake row
   (`copy_idx 1`, drink/mods omitted). Tarot-fallback cups: primary row only.
6. printer-client prints every pending row. Staff sees the drink-less labels as the
   keepsakes and hands them to the customer.

## Error handling

- Keepsake rendering/insert failures are non-fatal — they ride the same `after()` +
  try/catch the primary enqueue already uses. A failed keepsake never blocks the cup
  label or the paid order.
- A customized source that fails to load falls back to tarot → `keepsakeEligible` stays
  false → no keepsake printed for a cup whose custom art was lost. Correct.
- Flag absent / `false` → zero behavior change anywhere.

## Testing

- **`enqueue.test.ts`**: (a) `includeKeepsakeCopies` + a gallery/AI/drawn cup → 2 rows
  for that cup, second has `copy_idx 1`; (b) tarot-fallback cup with flag on → 1 row,
  no keepsake; (c) mixed order → keepsakes only for customized cups; (d) flag off →
  unchanged row count (regression); (e) `onConflict` includes `copy_idx`.
- **`render-zebra-cup.test.ts`**: `keepsake: true` ZPL omits drink name + modifier
  fields but retains greeting/sticker/doodle/logo; `keepsake` absent unchanged.
- **`payment/route.test.ts`**: `keepLabelCopy: true` in body → enqueue called with
  `includeKeepsakeCopies: true`; absent → `false`/undefined.
- **Checkout**: a unit test (or existing checkout test harness) asserting the toggle is
  gated on `hasAnyCustomizedCup` and forwards `keepLabelCopy` into the payment body.
- **Admin**: gallery query test asserting `copy_idx = 0` filter excludes keepsake rows.

## Out of scope (YAGNI)

- RN app parity (web only this round).
- Paid add-on / per-cup keepsake selection (single order-level free toggle).
- POS / webhook keepsakes.
- Any visual marker on the keepsake beyond the absence of drink/mods.
