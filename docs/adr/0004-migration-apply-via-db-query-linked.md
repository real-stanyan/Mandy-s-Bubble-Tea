# ADR 0004 — Cloud migrations apply one file at a time via `db query --linked`

Status: accepted (2026-07-27)
Issue: #75

## Context

`supabase/migrations/` holds 41 SQL files, but nothing in the repo said how one
of them reaches the cloud database. In practice they were pasted into the
Dashboard SQL Editor by hand. For an agent that left three unanswerable
questions — is this file applied? what command applies it? may I touch the
production database at all? — so the honest move was to stop and hand the step
back to Stan. That is exactly what blocked the app-download discount launch
(#72 recorded the migration as "Stan 手动做").

There is **one** Supabase project; dev and prod share it. There is no staging
database to rehearse against.

`supabase db push` is the obvious command and the wrong one: the remote has no
`schema_migrations` history, so push would attempt all 41 files, most of which
were already applied by hand. Several are not idempotent.

## Decision

**Apply exactly one file, through the Management API, with a state check on
either side.**

```bash
supabase link --project-ref fsvtwivogyebugqhmjjy --yes
supabase db query --linked "select to_regclass('public.<table>')"   # before
supabase db query --linked -f supabase/migrations/<file>.sql        # apply
supabase db query --linked "select to_regclass('public.<table>')"   # after
```

`db query --linked` executes only what it is given and never consults or writes
migration history, so it cannot cascade into unrelated files. The before/after
checks are not optional: without remote history they are the only evidence that
the migration was needed and that it landed.

**Agent authority over the production database:**

| Operation | Who |
|---|---|
| Additive DDL — `create table if not exists`, `create or replace function`, `add column`, `create index` | Agent, with before/after verification |
| `drop`, `alter column type`, `truncate` | Stan's explicit agreement first |
| `update` / `delete` on real rows | Stan's explicit agreement first |
| Deleting rows the agent itself created to test | Agent, and say so |

The split is by reversibility, not by risk-sounding-ness: additive DDL on an
absent object cannot destroy data, and the `if not exists` / `or replace` forms
make a repeat run a no-op.

## Alternatives considered

**`supabase db push` with a backfilled `schema_migrations` table** — the
textbook answer, and where this should end up. Rejected for now because
backfilling means asserting, for 41 files against a live database, which are
already applied. Getting that wrong re-runs a non-idempotent migration against
production. That audit is its own task, not a step inside a launch.

**Keep it manual (status quo)** — rejected: it makes every schema change block
on Stan being at a keyboard, and #72 showed that cost lands squarely on the
critical path of a launch.

## Consequences

- "Is this migration applied?" is still answered by querying for the object, not
  by reading a table. Migration files must stay idempotent and must name a
  checkable object.
- The local link writes `supabase/.temp/`; it is untracked and machine-local.
- The `schema_migrations` backfill remains open in #75 as the durable fix.

## What would invalidate this

A second Supabase project (staging), or the `schema_migrations` backfill
landing — either makes `db push` safe and this procedure obsolete.
