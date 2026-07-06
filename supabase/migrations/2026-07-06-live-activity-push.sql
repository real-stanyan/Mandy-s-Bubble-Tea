-- iOS Live Activity (ActivityKit) server push support.
--
-- One row per order that has a Live Activity running on the customer's
-- device. The app uploads the ActivityKit push token via
-- POST /api/orders/[orderId]/live-activity-token; the server pushes
-- content-state updates through APNs (apns-push-type: liveactivity).
--
-- No RLS: accessed exclusively via service-role client (getSupabaseAdmin),
-- same posture as device_push_tokens (2026-04-20-push-notifications.sql).
-- Do not wire client-side queries to this table without adding policies.
create table if not exists order_live_activities (
  order_id text primary key,
  activity_token text not null,
  updated_at timestamptz not null default now(),
  -- GPS heartbeat throttle: bumped by a WHERE-guarded UPDATE so concurrent
  -- driver location posts can't double-send within the 25s window.
  last_gps_push_at timestamptz
);

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
