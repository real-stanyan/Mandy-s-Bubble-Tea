-- Cup-label preset gallery: source of truth for default + admin-uploaded stickers.
create table if not exists public.gallery_presets (
  hash        text primary key,
  source      text not null check (source in ('builtin','upload')),
  storage     text not null check (storage in ('static','supabase')),
  hidden      boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  text,
  deleted_at  timestamptz,
  constraint gallery_presets_source_storage check (
    (source = 'builtin' and storage = 'static') or
    (source = 'upload'  and storage = 'supabase')
  )
);

create index if not exists gallery_presets_visible_idx
  on public.gallery_presets (sort_order)
  where hidden = false and deleted_at is null;

-- Public-read bucket for admin-uploaded presets ({hash}/color.png, {hash}/binarized.png).
insert into storage.buckets (id, name, public)
values ('cup-label-gallery', 'cup-label-gallery', true)
on conflict (id) do nothing;
