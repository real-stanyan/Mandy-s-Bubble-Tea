-- Order complaints: one row per complaint, used as a dedup table only.
-- Description and photos live in the outgoing email, never in this DB.
-- See docs/superpowers/specs/2026-04-26-order-complaint-channel-design.md

create table if not exists public.order_complaints (
  id          uuid primary key default gen_random_uuid(),
  order_id    text not null unique,
  customer_id text not null,
  user_id     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.order_complaints enable row level security;

-- Authenticated users may read their own complaint rows so the order detail
-- page can render "Reported on YYYY-MM-DD". All INSERTs go through the
-- service-role API route, so we don't expose a client INSERT policy.
create policy "complaints: select own" on public.order_complaints
  for select using (auth.uid() = user_id);

create index if not exists order_complaints_user_id_idx
  on public.order_complaints (user_id);
