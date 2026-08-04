-- Brute-force throttle for /staff/login.
--
-- The passcodes are short and shared by the whole shop, the login form sits on
-- the public customer domain, and this repository is public — so the only
-- thing between a scripted guesser and everybody's hours is how many attempts
-- per minute they get. Before this table there was no limit at all.
--
-- Why a table and not an in-process counter: every request can land on a
-- different serverless instance, so a Map in module scope forgets almost every
-- failure. The counter has to be somewhere all instances share.
--
-- One row per client IP, deleted on success. Rows for IPs that stop trying are
-- harmless (a handful of bytes) and get reused if the same IP comes back.

create table if not exists staff_login_attempts (
  ip text primary key,
  failures int not null default 0,
  -- Start of the current counting window; failures older than the window are
  -- forgotten by resetting this rather than by deleting rows.
  window_started_at timestamptz not null default now(),
  -- Set once the window's failure budget is spent. Null means "not locked".
  locked_until timestamptz
);

-- Cleanup ("delete everything untouched for a day") scans by window start.
create index if not exists staff_login_attempts_window_idx
  on staff_login_attempts (window_started_at);

-- Service-role only: RLS on, no policies. Written from the login server
-- action; the anon key must never be able to read it, because the row for an
-- IP tells an attacker exactly how much budget they have left.
alter table staff_login_attempts enable row level security;
