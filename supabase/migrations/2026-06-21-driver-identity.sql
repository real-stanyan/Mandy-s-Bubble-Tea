-- Driver identity — give each driver a persistent identity instead of one
-- shared STAFF_DELIVERY_TOKEN. The driver app's new History / Shift / Manager
-- screens all need to attribute deliveries, shifts and earnings to a specific
-- person. See mandys-driver/docs/driver-identity-proposal.md.
--
-- Login model unchanged in spirit: the driver still types a short code. The
-- code now resolves to a `drivers` row (code_hash = sha256(code)) → driver_id.
-- The manager keeps the shared ADMIN_DELIVERY_TOKEN (read-only).
--
-- All additive + idempotent: `driver_id` columns are nullable so the current
-- (anonymous) app keeps working until the new build ships.

-- ── drivers ──────────────────────────────────────────────────────────────────
create table if not exists public.drivers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code_hash   text not null unique,            -- sha256(login code), hex
  phone       text,
  suburb      text,
  vehicle     text,
  joined_at   date,
  rating      numeric(2,1),
  prefs       jsonb not null default '{}'::jsonb,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ── driver_shifts ────────────────────────────────────────────────────────────
create table if not exists public.driver_shifts (
  id            uuid primary key default gen_random_uuid(),
  driver_id     uuid not null references public.drivers(id) on delete cascade,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,                   -- null = currently on shift
  location_mode text not null default 'while'  -- 'while' | 'always'
    check (location_mode in ('while', 'always'))
);
-- one open shift per driver at most (partial unique)
create unique index if not exists driver_shifts_one_open_idx
  on public.driver_shifts (driver_id) where ended_at is null;

-- ── link dispatch + push tokens to the driver who owns them ───────────────────
alter table public.delivery_dispatch
  add column if not exists driver_id uuid references public.drivers(id);
create index if not exists delivery_dispatch_driver_idx
  on public.delivery_dispatch (driver_id);

alter table public.driver_push_tokens
  add column if not exists driver_id uuid references public.drivers(id);

-- ── RLS: deny-all (service role bypasses; routes are Bearer-guarded) ──────────
-- The code_hash is sensitive, so unlike the older driver tables we lock these
-- down with RLS-on + no policies. The /api/driver/* routes use the service-role
-- client, which is unaffected.
alter table public.drivers       enable row level security;
alter table public.driver_shifts enable row level security;

-- ── seed: Rick Zhang — the current (sole) driver, code "zmx" ──────────────────
-- sha256('zmx') = 051112567029392c0caff20c86f4b3808a9c2816522c6fa827f9781227ac3313
insert into public.drivers (name, code_hash, suburb)
values ('Rick Zhang', '051112567029392c0caff20c86f4b3808a9c2816522c6fa827f9781227ac3313', 'Southport')
on conflict (code_hash) do nothing;

-- Surface the schema change to PostgREST immediately.
notify pgrst, 'reload schema';
