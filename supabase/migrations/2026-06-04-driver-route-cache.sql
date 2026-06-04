-- Driver → destination route cache for the customer-facing live map.
--
-- The customer status endpoint (/api/orders/[orderId]/status) decorates its
-- tracking payload with a driving route (Google Directions). Directions is a
-- paid API polled by every客户 every 5s, so we cache the encoded polyline +
-- duration on the dispatch row and only re-query when the driver has moved
-- >150m from the cached route origin or the cache is older than 2 minutes.
--
-- Same trust model as the rest of delivery_dispatch: written by the
-- service-role client from the status route, no RLS.

alter table delivery_dispatch
  add column if not exists route_polyline text,
  add column if not exists route_origin_lat double precision,
  add column if not exists route_origin_lng double precision,
  add column if not exists route_duration_secs integer,
  add column if not exists route_fetched_at timestamptz;

-- Surface schema changes to PostgREST immediately so supabase-js sees the
-- new columns without waiting for the periodic reload.
notify pgrst, 'reload schema';
