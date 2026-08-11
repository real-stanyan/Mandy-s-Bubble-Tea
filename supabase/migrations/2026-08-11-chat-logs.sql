-- Transcript of every customer ↔ Mandy exchange, for the Admin log viewer.
--
-- One row per message so a conversation reads back in order. Grouped by
-- conversation_id, which the client mints per chat session; a client that
-- doesn't send one (an older App build) falls back to a server-derived id
-- so its turns still group instead of scattering.
--
-- These transcripts carry whatever customers typed — names, addresses,
-- complaints. Service-role only (RLS on, no policies), and a retention
-- sweep deletes anything older than the window (see
-- /api/cron/chat-log-retention). Keeping them forever is a liability, not
-- a feature.
--
-- Idempotent; verifiable object: public.chat_logs.
create table if not exists public.chat_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  conversation_id text not null,
  turn_index integer not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- 'web' | 'app', so the Admin view can tell where a conversation happened.
  surface text,
  ip_hash text,
  -- Outcome markers, so the log is scannable without reading every line:
  -- how many drinks the reply proposed, and whether it ended in checkout
  -- or filed a complaint.
  proposal_count integer not null default 0,
  action text
);

alter table public.chat_logs enable row level security;

create index if not exists chat_logs_conversation_idx
  on public.chat_logs (conversation_id, turn_index);
create index if not exists chat_logs_created_at_idx
  on public.chat_logs (created_at desc);
