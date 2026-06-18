-- Mandy Delivery: a driver "accepts" a delivery before picking it up. Accepting
-- captures the held card authorization (Square payments.complete) — i.e. it's
-- the moment the customer is actually charged. We record it on the dispatch row
-- so the flow is: accepted -> picked_up -> delivered.
--
-- Widen the status check to include 'accepted' and add an accepted_at stamp,
-- mirroring picked_up_at / delivered_at.

alter table delivery_dispatch
  drop constraint if exists delivery_dispatch_status_check;

alter table delivery_dispatch
  add constraint delivery_dispatch_status_check
  check (status in ('pending', 'accepted', 'picked_up', 'delivered'));

alter table delivery_dispatch
  add column if not exists accepted_at timestamptz;

-- Surface the schema change to PostgREST immediately.
notify pgrst, 'reload schema';
