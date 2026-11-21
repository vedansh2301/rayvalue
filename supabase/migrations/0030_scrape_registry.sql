-- Policy / tariff / news scraper pipeline (Wave 0, Track C): source registry, change snapshots, staged facts.
--
-- APPLY ORDER: after 0029 (Tracks A/B/D own 0024-0029, 0032). Nothing here is applied automatically.
-- Service-role only: RLS is enabled with NO policies and anon/authenticated lose every grant, so none of this is
-- readable through the public API. The scraper never writes to published fact tables; it only writes facts_staging,
-- and a human promotes staged facts after review (hard rule 1: no invented numbers).

create table if not exists public.sources (
  id                    uuid primary key default gen_random_uuid(),
  country               text not null check (country ~ '^[a-z]{2}$'),
  url                   text not null check (url ~ '^https?://'),
  source_name           text not null,
  type                  text not null default 'other' check (type in ('regulator', 'ministry', 'utility', 'statute', 'dataset', 'api', 'rss', 'news', 'other')),
  covers                text,
  language              text,
  notes                 text,
  origin                text not null default 'pack' check (origin in ('pack', 'fact')),
  update_cadence        text,
  cadence_days          integer not null default 30 check (cadence_days between 1 and 366),
  access                text not null default 'html' check (access in ('html', 'pdf', 'rss', 'json', 'csv', 'xlsx', 'other')),
  robots_ok             text not null default 'unknown' check (robots_ok in ('yes', 'no', 'unknown')),
  active                boolean not null default true,
  -- fetch state (written only by the fetcher, never by the pack importer)
  last_fetched_at       timestamptz,
  next_due_at           timestamptz,
  last_status           integer,
  last_error            text,
  consecutive_failures  integer not null default 0,
  content_hash          text,
  etag                  text,
  last_modified         text,
  last_changed_at       timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (country, url)
);
comment on table public.sources is 'Registry of official sources and feeds per country (from rvplan sources.csv, plus pages cited by facts.csv with origin=fact). last_status: HTTP status, 0 = network error/timeout, -1 = blocked by robots.txt or registry robots_ok=no, -2 = unsupported format.';
create index if not exists sources_due_idx on public.sources (next_due_at nulls first) where active;
create index if not exists sources_country_idx on public.sources (country);

create table if not exists public.source_snapshots (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references public.sources (id) on delete cascade,
  content_hash  text not null,
  fetched_at    timestamptz not null default now(),
  http_status   integer,
  byte_length   integer,
  text_length   integer,
  text_excerpt  text,
  storage_path  text,
  unique (source_id, content_hash)
);
comment on table public.source_snapshots is 'One row per distinct normalised content of a source (hash of the whitespace-normalised extracted text). text_excerpt = first 4000 characters; storage_path reserved for full copies.';
create index if not exists source_snapshots_source_idx on public.source_snapshots (source_id, fetched_at desc);

create table if not exists public.facts_staging (
  id              uuid primary key default gen_random_uuid(),
  natural_key     text not null unique,
  country         text not null check (country ~ '^[a-z]{2}$'),
  key             text not null,
  region          text not null default '',
  value           text,
  unit            text,
  valid_from      text not null default '',
  valid_to        text,
  source_url      text not null check (source_url ~ '^https?://'),
  publisher       text,
  retrieved_on    date,
  excerpt         text,
  confidence      text not null default 'primary' check (confidence in ('primary', 'secondary')),
  source_id       uuid references public.sources (id) on delete set null,
  status          text not null default 'new' check (status in ('new', 'changed', 'confirmed', 'rejected')),
  previous_value  text,
  checked_by      text,
  checked_at      timestamptz,
  check_note      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.facts_staging is 'Researched facts awaiting verification. natural_key = country|key|region|valid_from|unit|source_url. status: new (imported), changed (value differs from import, or the source page changed and the fact could not be re-matched: needs review), confirmed (matched against the fetched source text, or confirmed by a human), rejected. Never read by public pages.';
create index if not exists facts_staging_status_idx on public.facts_staging (status, country);
create index if not exists facts_staging_source_idx on public.facts_staging (source_id);

alter table public.sources enable row level security;
alter table public.source_snapshots enable row level security;
alter table public.facts_staging enable row level security;
revoke all on table public.sources, public.source_snapshots, public.facts_staging from public, anon, authenticated;
grant select, insert, update, delete on table public.sources, public.source_snapshots, public.facts_staging to service_role;
