-- v2: separate the lucky-cat default deck from the selectable gallery.
alter table public.gallery_presets
  add column if not exists kind text not null default 'gallery'
  check (kind in ('gallery','lucky_cat'));

create index if not exists gallery_presets_kind_visible_idx
  on public.gallery_presets (kind, sort_order)
  where hidden = false and deleted_at is null;
