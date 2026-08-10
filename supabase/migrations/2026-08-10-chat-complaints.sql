-- Chat-filed complaints. Unlike order_complaints this is not keyed to an
-- order or a signed-in user — the chatbox takes complaints from anyone,
-- with whatever contact detail they chose to leave. Stored BEFORE the
-- notification email is attempted (issue #132: "send first, store on
-- success" silently lost 69 days of complaints when the send broke).
--
-- Idempotent; verifiable object: public.chat_complaints.
create table if not exists public.chat_complaints (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  summary text not null,
  order_number text,
  contact text,
  ip_hash text,
  manager_notified boolean not null default false
);

-- Service-role only: RLS on with no policies means anon/authenticated get
-- nothing; the service key bypasses RLS. Same posture as chat_rate_limit.
alter table public.chat_complaints enable row level security;

create index if not exists chat_complaints_created_at_idx
  on public.chat_complaints (created_at desc);
