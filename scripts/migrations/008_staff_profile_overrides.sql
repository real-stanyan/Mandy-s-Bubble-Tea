-- Staff availability that can change without a code deploy.
--
-- Who can work which days, which shifts, and how many units a week lived in
-- src/lib/staff/roster/model.ts. That was fine while it never changed; it
-- stopped being fine the first time someone's availability changed — Elle
-- going from Saturday-only to more days needed a developer.
--
-- Rows are effective-from, not per-week. "Elle can do more from the week of
-- the 17th" is one row, and every week from then on inherits it; setting it
-- per week would mean re-entering the same numbers every Monday. Resolving a
-- week means taking, per person, the row with the greatest effective_from at
-- or before that week, and falling back to the code defaults when there is
-- none — so weeks before the change keep the old shape and stay accurate.

create table if not exists staff_profile_overrides (
  -- Matches the id in model.ts (hanna, emily, karen, eugenia, celina, elle).
  staff_id text not null,
  -- ISO date of the Monday this takes effect, e.g. '2026-08-17'.
  effective_from text not null,

  -- Weekday keys: mon, tue, wed, thu, fri, sat, sun.
  days text[] not null,
  -- Shift kinds: open, mid, close.
  kinds text[] not null,
  -- Weekly allowance in shift-units, where a 12-22 counts as two.
  min_units int not null,
  max_units int not null,

  updated_at timestamptz not null default now(),
  primary key (staff_id, effective_from)
);

-- The resolve query is "everything effective at or before this week, newest
-- first", per person.
create index if not exists staff_profile_overrides_lookup_idx
  on staff_profile_overrides (staff_id, effective_from desc);

-- Service-role only: RLS on, no policies. Read and written through
-- /api/staff/roster-profiles, which is gated on the owner passcode — this is
-- everyone's working hours.
alter table staff_profile_overrides enable row level security;
