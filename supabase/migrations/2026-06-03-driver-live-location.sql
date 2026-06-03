-- Driver live location — real-time GPS for customer-facing delivery tracking.
--
-- The driver app streams its GPS position while a delivery is in progress
-- (picked_up → delivered). We stash the latest fix on the existing
-- delivery_dispatch row (keyed by Square order_id) rather than a new table,
-- because there's exactly one active driver per order and we only ever need
-- the *latest* point for the customer's live map — no breadcrumb history.
--
-- Written exclusively by the service-role client behind the Bearer-guarded
-- POST /api/driver/location route; read back by the customer status endpoint
-- (/api/orders/[orderId]/status). Still no RLS — same trust model as the rest
-- of delivery_dispatch.

alter table delivery_dispatch
  add column if not exists driver_lat double precision,
  add column if not exists driver_lng double precision,
  add column if not exists driver_heading double precision,
  add column if not exists location_updated_at timestamptz;

-- Surface schema changes to PostgREST immediately so supabase-js sees the
-- new columns without waiting for the periodic reload.
notify pgrst, 'reload schema';
