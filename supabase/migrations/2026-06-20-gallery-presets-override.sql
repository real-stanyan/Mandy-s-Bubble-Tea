-- Re-processed built-ins store their canonical binarized.png in the
-- cup-label-gallery bucket; override_at non-null = bucket supersedes disk.
alter table gallery_presets
  add column if not exists override_at timestamptz default null;
