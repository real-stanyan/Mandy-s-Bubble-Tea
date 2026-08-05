-- Keep the complaint itself, not just the fact that one happened.
--
-- `order_complaints` recorded five columns — id, order_id, customer_id,
-- user_id, created_at — and the customer's actual words lived only in the
-- email. The row was also written *after* a successful send, deliberately, so
-- that a failed send left no dedup row and the customer could retry.
--
-- Those two decisions together mean a broken mail provider erases complaints
-- with no trace. That is not hypothetical: the Resend key in production was a
-- deleted one for 69 days (issue #130), every complaint in that window
-- returned 502, and nothing anywhere recorded that it had been attempted or
-- what it said. Two rows survive, both from before the outage.
--
-- The row is now written first and marked `sent` afterwards, so the text
-- survives whatever the mail provider does.

alter table order_complaints
  -- The customer's own words. Nullable because the two historical rows
  -- predate this and their text is gone.
  add column if not exists description text,
  -- Photos still ride the email only; this records that some existed so a
  -- report with evidence is distinguishable from one without.
  add column if not exists photo_count int not null default 0,
  add column if not exists photo_filenames text[] not null default '{}',
  -- 'pending' — row written, send not yet attempted or in flight
  -- 'sent'    — Resend accepted it
  -- 'failed'  — Resend rejected it; the complaint is still here to act on
  --
  -- Defaults to 'sent' so the two historical rows keep their meaning: they
  -- were only ever written on success. New rows always set it explicitly.
  add column if not exists status text not null default 'sent',
  add column if not exists failure_reason text,
  add column if not exists sent_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table order_complaints
  drop constraint if exists order_complaints_status_check;
alter table order_complaints
  add constraint order_complaints_status_check
  check (status in ('pending', 'sent', 'failed'));

-- The question this table could not answer before: which complaints never
-- reached anyone.
create index if not exists order_complaints_status_idx
  on order_complaints (status, created_at desc);
