-- Partial index on printer_token for fast ack lookups.
-- printer_token is set only while a job is 'printing' (small subset),
-- so a partial index is the right fit.
create index if not exists cup_label_jobs_printer_token_idx
  on cup_label_jobs (printer_token)
  where printer_token is not null;
