-- RayValue social CMS: Instagram posts (Reels, photos, carousels, Stories), their media, caption/hashtag templates,
-- an event log, a single settings row and the current Instagram access token.
--
-- APPLY ORDER: after 0013, before deploying the /admin/social code. Nothing here is applied automatically.
-- Every table is server-only: RLS on, no anon/authenticated grants; the site reaches them with SUPABASE_SECRET_KEY.

-- ------------------------------------------------------------ settings (one row)
-- auto_publish: posts that pass every check go out at their time without review (owner's choice, 2026-10-26).
-- paused: the "Pause all posting" switch; the publisher does nothing while true.
create table if not exists public.social_settings (
  id           boolean primary key default true check (id),
  auto_publish boolean not null default true,
  paused       boolean not null default false,
  timezone     text not null default 'America/New_York' check (char_length(timezone) <= 60),
  notify_email boolean not null default true,
  updated_at   timestamptz not null default now()
);
insert into public.social_settings (id) values (true) on conflict (id) do nothing;
-- Weekly posting slots in `timezone`: dow 0 = Sunday ... 6 = Saturday, time "HH:MM", type = which post type fills it.
-- The generator fills the next free slot; the owner edits them on /admin/social/settings. A starting cadence, not data.
alter table public.social_settings
  add column if not exists slots jsonb not null default
    '[{"dow":1,"time":"18:00","type":"reel"},{"dow":2,"time":"12:00","type":"carousel"},{"dow":3,"time":"18:00","type":"reel"},{"dow":4,"time":"12:00","type":"carousel"},{"dow":5,"time":"18:00","type":"reel"}]'::jsonb
    check (jsonb_typeof(slots) = 'array');

-- ------------------------------------------------------------ media library
-- Files live in the public Storage bucket `social` (Instagram fetches media from a public URL).
-- credit/license: required for anything not made by RayValue (same rule as src/assets/photos/CREDITS.md).
create table if not exists public.social_media (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('video', 'image')),
  storage_path text not null unique check (char_length(storage_path) between 1 and 300),
  public_url   text not null check (public_url ~ '^https://' and char_length(public_url) <= 600),
  mime         text not null check (mime in ('video/mp4', 'video/quicktime', 'image/jpeg')),
  bytes        bigint null check (bytes is null or bytes > 0),
  width        integer null check (width is null or width > 0),
  height       integer null check (height is null or height > 0),
  duration_s   numeric(7, 2) null check (duration_s is null or duration_s > 0),
  alt_text     text null check (alt_text is null or char_length(alt_text) <= 1000),
  credit       text null check (credit is null or char_length(credit) <= 300),
  license      text null check (license is null or char_length(license) <= 120),
  source       text not null default 'upload' check (source in ('upload', 'generated')),
  created_at   timestamptz not null default now()
);
create index if not exists social_media_created_idx on public.social_media (created_at desc);

-- ------------------------------------------------------------ posts
-- Status flow (src/lib/social/status.ts is the source of truth for allowed moves):
--   draft -> review | scheduled ; review -> draft | scheduled ; scheduled -> draft | publishing | failed
--   publishing -> published | failed ; failed -> scheduled | draft ; any but publishing -> archived
-- data_refs: where every number in the caption/media came from, e.g.
--   [{"table":"utilities","id":"fpl","field":"payback_low_years","value":"9"}] (src/lib/social/checks.ts).
create table if not exists public.social_posts (
  id                uuid primary key default gen_random_uuid(),
  type              text not null check (type in ('reel', 'image', 'carousel', 'story')),
  status            text not null default 'draft'
                      check (status in ('draft', 'review', 'scheduled', 'publishing', 'published', 'failed', 'archived')),
  title             text not null default '' check (char_length(title) <= 120),
  caption           text not null default '' check (char_length(caption) <= 2200),
  origin            text not null default 'upload' check (origin in ('upload', 'generated')),
  template_key      text null check (template_key is null or char_length(template_key) <= 80),
  data_refs         jsonb not null default '[]'::jsonb check (jsonb_typeof(data_refs) = 'array'),
  -- Owner ticked "I checked every number in this caption" (lets an upload with untraced numbers through).
  numbers_confirmed boolean not null default false,
  share_to_feed     boolean not null default true,
  thumb_offset_ms   integer null check (thumb_offset_ms is null or thumb_offset_ms >= 0),
  scheduled_at      timestamptz null,
  checks            jsonb not null default '[]'::jsonb,
  checks_passed     boolean not null default false,
  ig_container_id   text null check (ig_container_id is null or char_length(ig_container_id) <= 64),
  ig_media_id       text null check (ig_media_id is null or char_length(ig_media_id) <= 64),
  ig_permalink      text null check (ig_permalink is null or char_length(ig_permalink) <= 300),
  published_at      timestamptz null,
  attempts          smallint not null default 0 check (attempts >= 0),
  last_error        text null check (last_error is null or char_length(last_error) <= 1000),
  insights          jsonb null,
  insights_at       timestamptz null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (status <> 'scheduled' or scheduled_at is not null),
  check (status <> 'published' or ig_media_id is not null)
);
create index if not exists social_posts_due_idx on public.social_posts (scheduled_at) where status in ('scheduled', 'publishing');
create index if not exists social_posts_status_idx on public.social_posts (status, updated_at desc);

-- Ordered media of a post (a carousel has 2-10; Reel/photo/Story have 1).
create table if not exists public.social_post_media (
  post_id  uuid not null references public.social_posts (id) on delete cascade,
  media_id uuid not null references public.social_media (id) on delete restrict,
  position smallint not null check (position between 0 and 9),
  primary key (post_id, position)
);
create index if not exists social_post_media_media_idx on public.social_post_media (media_id);

-- ------------------------------------------------------------ templates
create table if not exists public.social_templates (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('caption', 'hashtags')),
  name       text not null check (char_length(name) between 1 and 80),
  body       text not null check (char_length(body) between 1 and 2200),
  created_at timestamptz not null default now(),
  unique (kind, name)
);

-- ------------------------------------------------------------ event log
create table if not exists public.social_events (
  id      bigint generated always as identity primary key,
  post_id uuid null references public.social_posts (id) on delete cascade,
  at      timestamptz not null default now(),
  event   text not null check (char_length(event) between 1 and 60),
  detail  jsonb null
);
create index if not exists social_events_post_idx on public.social_events (post_id, at desc);
create index if not exists social_events_at_idx on public.social_events (at desc);

-- ------------------------------------------------------------ Instagram access token
-- Long-lived tokens last ~60 days and refreshing can return a new value, which a cron job cannot write back to the
-- Vercel env. The env IG_ACCESS_TOKEN is the bootstrap; after the first refresh the current token lives here.
-- Server-only like every table above (service_role).
create table if not exists public.social_auth (
  id           boolean primary key default true check (id),
  access_token text not null check (char_length(access_token) between 20 and 1000),
  expires_at   timestamptz null,
  refreshed_at timestamptz not null default now()
);

-- ------------------------------------------------------------ updated_at
create or replace function public.social_touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists social_posts_touch on public.social_posts;
create trigger social_posts_touch before update on public.social_posts for each row execute function public.social_touch_updated_at();
drop trigger if exists social_settings_touch on public.social_settings;
create trigger social_settings_touch before update on public.social_settings for each row execute function public.social_touch_updated_at();

-- ------------------------------------------------------------ access: server only
do $$
declare t text;
begin
  foreach t in array array['social_settings', 'social_media', 'social_posts', 'social_post_media', 'social_templates', 'social_events', 'social_auth'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;
grant usage on sequence public.social_events_id_seq to service_role;

-- ------------------------------------------------------------ storage bucket
-- Public read (Instagram must fetch the file); writes only with the secret key or a server-issued signed upload URL.
-- 50 MB is the Supabase Free plan's per-file cap.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social', 'social', true, 52428800, array['video/mp4', 'video/quicktime', 'image/jpeg'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
