# Cup-label fortune precompute design

**Date**: 2026-05-21
**Branch**: `feat/cup-label-zebra-zd410`
**Status**: Approved by Stan 2026-05-21

## Problem

The in-store (Square POS) cup-label webhook path currently calls
`api.deepseek.com/v1/chat/completions` synchronously to generate N
fortune sentences for an N-cup order. The DeepSeek round-trip is the
only AI step in the in-store flow and dominates the time between
webhook receipt and a print job hitting the queue. Stan reports the
end-to-end print latency feels slow at the counter.

The web/app checkout doodle path (Doubao Seedream) is unaffected by
this design.

## Goals

- Eliminate DeepSeek round-trip from the in-store hot path.
- Keep fortune style/quality at parity with what DeepSeek + the current
  `SYSTEM_PROMPT` would produce, so the visible output on the cup label
  is indistinguishable from today's.
- Preserve the public API of `generateFortunes(count)` so no caller
  (`enqueue.ts`, `render-zebra-cup.ts`, `scripts/print-pos-fortune.ts`)
  needs to change.

## Non-goals

- Categorisation / themes / season-specific fortunes.
- Tracking usage / "don't repeat the same line twice in a row".
- Admin UI for editing fortunes (out of scope for v1 — edit via SQL or
  re-seed by re-running migration).
- Touching the web/app checkout doodle pipeline.

## Design

### 1. Storage

New Supabase migration on the `feat/cup-label-zebra-zd410` branch:

```sql
-- supabase/migrations/2026-05-21-cup-label-fortunes.sql
CREATE TABLE cup_label_fortunes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- 500 INSERTs inlined below
```

- No RLS policy. The table is read only by server-only code via the
  service-role client (`getSupabaseAdmin()`). This matches the existing
  pattern for `cup_label_jobs` / `cup_label_ai_jobs`.
- No additional index. 500 rows ⇒ sequential scan completes in well
  under 1ms even cold.
- The 500 INSERT statements are inlined in the migration file as the
  source of truth. The migration is idempotent at the schema level
  (`CREATE TABLE IF NOT EXISTS` or single `CREATE TABLE` on a fresh
  DB); inserts use `ON CONFLICT (text) DO NOTHING` so the migration is
  re-runnable.

### 2. Selection

`generateFortunes(count: number): Promise<string[]>` is rewritten as:

```ts
const { data, error } = await getSupabaseAdmin()
  .rpc('cup_label_random_fortunes', { n: count });
if (error || !data || data.length < count) {
  console.warn(`[fortune] DB miss (${error?.message ?? 'short result'}) — using fallback pool`);
  return pickFromPool(count);
}
return data.map((r) => r.text);
```

A SQL function `cup_label_random_fortunes(n int)` is added in the same
migration so the random selection is one round-trip and supabase-js
doesn't need to express `ORDER BY random()` (which it doesn't support
in `.order()`):

```sql
CREATE OR REPLACE FUNCTION cup_label_random_fortunes(n int)
RETURNS TABLE(text text)
LANGUAGE sql
STABLE
AS $$
  SELECT text FROM cup_label_fortunes ORDER BY random() LIMIT n;
$$;
GRANT EXECUTE ON FUNCTION cup_label_random_fortunes(int) TO service_role;
```

If `count` exceeds 500 (which it never should — Square POS orders cap
out well below this), the function naturally returns 500 rows and the
caller's `data.length < count` check trips the fallback pool path.

### 3. Fallback policy

DB query failure (network error, table missing, RPC error, fewer than
N rows returned) ⇒ `pickFromPool(count)` using the existing 30-line
hardcoded `FALLBACK_POOL`. This is the same fallback `fortune.ts` uses
today when DeepSeek fails. It survives DB outages without falling
through to "print job with no fortune".

The runtime DeepSeek code path is **deleted entirely**. The
`DEEPSEEK_API_KEY` env variable is no longer read by the cup-label
webhook path. It may still be set for the StackChan agent project —
that project is unrelated and uses its own env file.

### 4. Code changes to `src/lib/cup-label/fortune.ts`

**Kept**:
- `FALLBACK_POOL` (the 30 hand-vetted fallback lines)
- `isSafeFortune` (safety validator — kept so the seed script can reuse
  it for offline validation, and so future re-seeds inherit the rule)
- `pickFromPool` (random selection from the fallback pool)
- Exported function `generateFortunes(count): Promise<string[]>`
  signature unchanged
- `__test__` export surface (re-aimed at the new internal helpers)

**Removed**:
- `callDeepSeek` function
- `parseFortunes` function
- `ENDPOINT`, `MODEL`, `TIMEOUT_MS`, `MIN_WORDS`, `MAX_WORDS` constants
- `SYSTEM_PROMPT` constant (moved to seed script — it documents how the
  500 lines were generated and is needed if anyone re-runs the seed)

**Added**:
- DB select via `getSupabaseAdmin().rpc('cup_label_random_fortunes', { n: count })`
- Concise header comment explaining the new design (DB-backed with
  hardcoded pool fallback) — replaces the existing DeepSeek-flavoured
  header.

### 5. 500-line generation

500 fortunes are generated by Claude (this agent) directly during
implementation, not by running an automated script against DeepSeek.
Each candidate line is:
1. Constrained to 5–12 words.
2. Filtered through `isSafeFortune` (the same validator the runtime
   code uses).
3. Required to be unique across the full 500-line set (case-insensitive
   match against existing lines).
4. Required to share style/topic constraints with the existing
   `SYSTEM_PROMPT` (present-moment warmth, gratitude, kindness, daily
   joys, tea/sweetness/bubbles, gentle optimism; no romance / money /
   religion / death / etc.).

The 500 lines are inlined as INSERT statements in the migration file.
There is no separate seed script — Stan accepted that re-seeding means
writing a new migration with `ON CONFLICT (text) DO NOTHING`.

### 6. Test changes to `src/lib/cup-label/fortune.test.ts`

- Drop `fetch` mocks for DeepSeek and `parseFortunes` cases.
- Add Supabase client mock cases:
  - RPC returns N rows ⇒ `generateFortunes(N)` returns those texts.
  - RPC returns short result (< N) ⇒ falls back to pool.
  - RPC errors ⇒ falls back to pool.
- Keep `isSafeFortune` direct unit cases.
- Keep `pickFromPool` direct unit cases.

### 7. Callers (no changes)

`enqueue.ts`, `render-zebra-cup.ts`, `scripts/print-pos-fortune.ts`
each call `generateFortunes(count)` and treat the result as
`string[]`. Interface is preserved.

### 8. Migration apply path

Migration is applied to Mandy prod Supabase project
`fsvtwivogyebugqhmjjy` via the `mcp__supabase__apply_migration` tool.
Per memory `feedback_supabase_mcp_migration_timestamp.md`, the ledger
version timestamp will drift from the local filename timestamp — fix
that with a `git mv` once apply confirms the version.

### 9. Branch / commit / push policy

All changes land on `feat/cup-label-zebra-zd410` on top of the
existing local-only commit `f2aee27` (Stan's gallery picker). Nothing
is pushed; nothing PR'd. The branch ships as one piece when ZD410
cutover happens alongside cup-label gallery + Mac mini + ZD411
retirement, per existing QUEUE plan.

## Risks / open questions

- **R1: Postgres `random()` quality.** It's a PRNG, not crypto-secure.
  Acceptable here — repeating the same line on consecutive cups every
  ~22 cups (the birthday-collision threshold for a 500-pool) is fine
  for fortune cookies and matches the existing DeepSeek behaviour's
  natural collision rate.
- **R2: 500 may grow stale.** No mechanism for replacement / rotation
  yet. Out of scope for v1; if Stan wants seasonal rotation later,
  add a `tags text[]` column and filter in the RPC.
- **R3: Schema lives on an unpushed branch.** If Stan needs to roll
  back the cup-label branch, the table + RPC stay in prod. Acceptable
  — they're inert when no caller reads from them, and the
  `cup_label_fortunes` namespace is uncontested.

## Out-of-scope follow-ups

- Admin page to add/edit/remove fortunes without re-seeding.
- Per-day / per-season fortune sets.
- Track last-served fortune to avoid back-to-back duplicates within an
  order (current design intentionally allows it — pure random per cup).
- Multi-language (Chinese fortunes for the Brisbane Mandarin clientele).
