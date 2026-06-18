-- Mandy Delivery: a driver "accepts" a delivery before picking it up. Accepting
-- captures the held card authorization (Square payments.complete) — i.e. it's
-- the moment the customer is actually charged. We record it on the dispatch row
-- so the flow is: accepted -> picked_up -> delivered.
--
-- Widen the status check to include 'accepted' and add an accepted_at stamp,
-- mirroring picked_up_at / delivered_at.
--
-- The original status check was an inline column constraint, so its name is
-- auto-generated. Drop whichever check constraint currently governs status by
-- discovery rather than guessing the name — keeps this safe to run even if the
-- auto-name differs from the conventional delivery_dispatch_status_check.

do $$
declare c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.delivery_dispatch'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format(
      'alter table public.delivery_dispatch drop constraint %I',
      c
    );
  end loop;
end $$;

alter table public.delivery_dispatch
  add constraint delivery_dispatch_status_check
  check (status in ('pending', 'accepted', 'picked_up', 'delivered'));

alter table public.delivery_dispatch
  add column if not exists accepted_at timestamptz;

-- Surface the schema change to PostgREST immediately.
notify pgrst, 'reload schema';
