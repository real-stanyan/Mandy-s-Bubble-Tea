-- Storage buckets for doodle artefacts.
-- doodles/        — per-order user-or-default rendered PNG + raster .bin (24h GC)
-- doodles_pool/   — pre-rendered default pool raster bins (permanent)

insert into storage.buckets (id, name, public, file_size_limit)
  values
    ('doodles', 'doodles', false, 1048576),         -- 1MB
    ('doodles_pool', 'doodles_pool', false, 524288) -- 512KB
  on conflict (id) do nothing;

-- service-role only — no policies.
