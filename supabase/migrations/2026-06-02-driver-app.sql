-- Driver app — push tokens + delivery dispatch lifecycle.
--
-- The driver app authenticates with a single shared store password (no
-- per-driver auth.users accounts), so unlike device_push_tokens these tables
-- are NOT tied to auth.users. No RLS: accessed exclusively via the
-- service-role client (getSupabaseAdmin) behind the Bearer-guarded
-- /api/driver/* routes. Do not wire client-side queries here.

-- Expo push tokens for driver devices. Keyed on token (unique) so the same
-- phone re-registering is a no-op upsert. `label` is an optional free-text
-- driver name typed at registration, purely for the owner's debugging.
create table if not exists driver_push_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  platform text not null check (platform in ('ios','android')),
  label text,
  app_version text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Delivery-specific lifecycle, separate from Square's fulfillment state so
-- the two don't fight over semantics. order_id is the Square order id. We
-- still flip the Square fulfillment state (PREPARED/COMPLETED) for POS
-- visibility, but record who drove it and when here.
create table if not exists delivery_dispatch (
  order_id text primary key,
  order_number text,
  status text not null default 'pending'
    check (status in ('pending','picked_up','delivered')),
  driver_label text,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists delivery_dispatch_status_idx
  on delivery_dispatch (status);

-- Reuse the order_push_notifications idempotency ledger for the
-- "new delivery → notify drivers" push (one per order). Widen the kind
-- check so claimOrderPushSlot(orderId, 'new_delivery') can dedupe Square
-- webhook retries the same way it does for 'ready'.
alter table order_push_notifications
  drop constraint if exists order_push_notifications_kind_check;
alter table order_push_notifications
  add constraint order_push_notifications_kind_check
  check (kind in ('ready', 'new_delivery'));
