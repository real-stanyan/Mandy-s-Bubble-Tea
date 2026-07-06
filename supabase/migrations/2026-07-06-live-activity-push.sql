-- iOS Live Activity (ActivityKit) server push support.
--
-- One row per order that has a Live Activity running on the customer's
-- device. The app uploads the ActivityKit push token via
-- POST /api/orders/[orderId]/live-activity-token; the server pushes
-- content-state updates through APNs (apns-push-type: liveactivity).
--
-- Accessed exclusively via the service-role client (getSupabaseAdmin),
-- which bypasses RLS — so RLS is enabled with NO policies: anon/authed
-- PostgREST access is fully locked out (an RLS-off table is readable via
-- the anon key, and activity_token must not leak). Add policies before
-- wiring any client-side queries to this table.
create table if not exists order_live_activities (
  order_id text primary key,
  activity_token text not null,
  updated_at timestamptz not null default now(),
  -- GPS heartbeat throttle: bumped by a WHERE-guarded UPDATE so concurrent
  -- driver location posts can't double-send within the 25s window.
  last_gps_push_at timestamptz
);

alter table order_live_activities enable row level security;

-- Widen the order_push_notifications idempotency ledger so Live Activity
-- status transitions dedupe the same way 'ready' / 'new_delivery' do
-- (Square redelivers webhooks; the driver app can re-tap actions).
alter table order_push_notifications
  drop constraint if exists order_push_notifications_kind_check;
alter table order_push_notifications
  add constraint order_push_notifications_kind_check
  check (kind in (
    'ready',
    'new_delivery',
    'la_ready',
    'la_completed',
    'la_canceled',
    'la_accepted',
    'la_picked_up',
    'la_delivered'
  ));
