-- Weekly rosters for /staff/roster.
--
-- Was localStorage, which meant the roster only existed on the device that
-- built it — the person planning the week could see it and nobody else could.
-- One row per week, keyed by the ISO date of its Monday (same key the app
-- already uses), so the key sorts chronologically as plain text and doesn't
-- depend on anyone's locale or timezone the way a week number would.
--
-- The three pieces are stored separately rather than as one blob because they
-- answer different questions and change at different times: who is on which
-- shift, who is away this week, and which placements were made by hand and
-- must survive an auto-fill.

create table if not exists staff_rosters (
  -- ISO date of the Monday, e.g. '2026-08-03'.
  week_key text primary key,
  -- slotId -> staff id, e.g. {"mon-open-0": "hanna"}.
  roster jsonb not null default '{}'::jsonb,
  -- staff id -> {off, on, offShifts, onShifts} for that week.
  availability jsonb not null default '{}'::jsonb,
  -- slotIds placed by hand; auto-fill rebuilds around these.
  pinned jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  -- Free text from the roster page, for "who last touched this".
  updated_by text
);

-- The roster page lists weeks newest-first.
create index if not exists staff_rosters_updated_idx
  on staff_rosters (updated_at desc);

-- Service-role only: RLS on, no policies. Every read and write goes through
-- /api/staff/roster, which is gated on the owner passcode. Without RLS enabled
-- the anon key would expose every employee's hours to the public site.
alter table staff_rosters enable row level security;
