-- Loyalty marketing pushes, moved out of one-off scripts and into
-- /admin/loyalty-push. Two tables: one row per campaign run (history +
-- what copy went out), one row per recipient phone (the cooldown key).
--
-- Why phone and not user_id: the audience is built by joining Square
-- Loyalty accounts (keyed by phone mapping) to app installs. Phone is the
-- only identity that spans both systems, and it survives account deletion
-- and re-signup — the same property welcome_discount_history relies on
-- (see 004). A customer who deletes and re-registers must not be able to
-- reset their own marketing cooldown.

-- 1. One row per send. Records the copy that actually went out, because
--    the copy is editable in the admin UI — without this, history would
--    say "we pushed 43 people" with no way to know what they read.
create table if not exists loyalty_push_runs (
  id uuid primary key default gen_random_uuid(),
  campaign text not null,
  title_singular text not null,
  body_singular text not null,
  title_plural text not null,
  body_plural text not null,
  cooldown_days int not null,
  -- Audience funnel, kept so a run that reached nobody is explainable
  -- after the fact (eligible-but-no-app vs suppressed-by-cooldown are
  -- very different problems).
  eligible_count int not null default 0,
  suppressed_count int not null default 0,
  targeted_count int not null default 0,
  accepted_count int not null default 0,
  errored_count int not null default 0,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists loyalty_push_runs_campaign_created_idx
  on loyalty_push_runs (campaign, created_at desc);

-- 2. One row per phone per run. This is what the cooldown reads: a phone
--    with a row for this campaign inside the window is skipped.
create table if not exists loyalty_push_recipients (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references loyalty_push_runs (id) on delete cascade,
  campaign text not null,
  phone_e164 text not null,
  -- Denormalised from the run so the cooldown lookup is a single-table
  -- index scan instead of a join on every audience build.
  sent_at timestamptz not null default now()
);

create index if not exists loyalty_push_recipients_cooldown_idx
  on loyalty_push_recipients (campaign, phone_e164, sent_at desc);

-- Service-role only: RLS on, no policies. Both tables are written by the
-- admin API route (service role) and never read from the browser.
alter table loyalty_push_runs enable row level security;
alter table loyalty_push_recipients enable row level security;
