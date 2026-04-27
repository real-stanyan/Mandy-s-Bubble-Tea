-- Bucket for user-uploaded doodle path JSON files (pre-render staging).
-- Server-only access (service role); client uploads go through /api/doodle/upload
-- which writes via the admin client. RLS denies all client-direct access.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'doodles_pending',
  'doodles_pending',
  false,
  131072,                     -- 128KB cap; well above ~30KB of typical paths JSON
  array['application/json']
)
on conflict (id) do nothing;
