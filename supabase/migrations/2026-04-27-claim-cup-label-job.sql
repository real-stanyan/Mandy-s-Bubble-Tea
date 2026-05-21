create or replace function claim_oldest_cup_label_job()
returns table (id uuid, raster_path text, printer_token text)
language plpgsql
as $$
declare
  token text := gen_random_uuid()::text;
begin
  return query
  with nxt as (
    select j.id from cup_label_jobs j
     where j.status = 'pending'
     order by j.created_at
     for update skip locked
     limit 1
  )
  update cup_label_jobs j
     set status = 'printing',
         attempts = j.attempts + 1,
         printer_token = token
   from nxt
   where j.id = nxt.id
   returning j.id, j.raster_path, j.printer_token;
end;
$$;
