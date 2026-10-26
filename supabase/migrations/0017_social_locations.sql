-- RayValue social CMS: location tags for Instagram and Facebook posts.
--
-- APPLY ORDER: after 0016, before deploying the publisher code that reads social_posts.location_key. Additive only.
--
-- social_locations: one row per place a post can be tagged with. fb_place_id is the id of a Facebook Page that has
-- location data (Instagram's container `location_id` and Facebook's `place` both take it). It is a fact, so it carries
-- source_url + verified_on; null = no verified id yet (the post is then published without a location).
-- targets: the generator targets (utility slug or state code, see src/lib/social/gen/plan.ts) whose posts get this
-- location. A target should appear in at most one row; the generator takes the first row by key if not.
--
-- How the seeded ids were verified on 2026-10-26:
--  1. City ids from Wikidata property P1997 (Facebook Places ID) of the city's item; state ids from Facebook's
--     public /pages/<name>/<id> page.
--  2. https://www.facebook.com/<id> opened publicly: cities redirect to Facebook's "Things to do in <City>, <State>"
--     place page (/places/...), states to the page named after the state.
--  3. Instagram accepted each id as `location_id` on an unpublished image container (POST /{ig-user-id}/media,
--     status FINISHED; never published), while a Page without location data was refused (code 100, subcode
--     2207019). Graph API reads of these Pages (GET /{id}?fields=name,location) need Page Public Metadata Access,
--     which the app does not have, and Pages Search is refused for the same reason.

create table if not exists public.social_locations (
  key         text primary key check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(key) <= 40),
  name        text not null check (char_length(name) between 1 and 120),
  fb_place_id text null check (fb_place_id is null or fb_place_id ~ '^[0-9]{5,30}$'),
  targets     text[] not null default '{}' check (cardinality(targets) <= 20),
  source_url  text null check (source_url is null or (source_url ~ '^https://' and char_length(source_url) <= 300)),
  verified_on date null,
  created_at  timestamptz not null default now(),
  -- A place id is a fact: it needs its source and date.
  check (fb_place_id is null or (source_url is not null and verified_on is not null))
);

alter table public.social_locations enable row level security;
revoke all on table public.social_locations from anon, authenticated;
grant select, insert, update, delete on table public.social_locations to service_role;

insert into public.social_locations (key, name, fb_place_id, targets, source_url, verified_on) values
  ('miami-fl',         'Miami, Florida',               '110148382341970', '{fpl}',                 'https://www.wikidata.org/wiki/Q8652#P1997',  '2026-10-26'),
  ('orlando-fl',       'Orlando, Florida',             '108288992526695', '{duke-energy-florida}', 'https://www.wikidata.org/wiki/Q49233#P1997', '2026-10-26'),
  ('tampa-fl',         'Tampa, Florida',               '105638029469653', '{teco}',                'https://www.wikidata.org/wiki/Q49255#P1997', '2026-10-26'),
  ('florida',          'Florida',                      '109714185714936', '{fl}',                  'https://www.facebook.com/pages/Florida/109714185714936/', '2026-10-26'),
  ('san-francisco-ca', 'San Francisco, California',    '114952118516947', '{pge}',                 'https://www.wikidata.org/wiki/Q62#P1997',    '2026-10-26'),
  ('los-angeles-ca',   'Los Angeles, California',      '110970792260960', '{sce}',                 'https://www.wikidata.org/wiki/Q65#P1997',    '2026-10-26'),
  ('san-diego-ca',     'San Diego, California',        '110714572282163', '{sdge}',                'https://www.wikidata.org/wiki/Q16552#P1997', '2026-10-26'),
  ('california',       'California',                   '108131585873862', '{ca}',                  'https://www.facebook.com/pages/California/108131585873862/', '2026-10-26')
on conflict (key) do nothing;

-- The post's location tag (null = none). Existing posts stay untagged.
alter table public.social_posts
  add column if not exists location_key text null references public.social_locations (key) on update cascade on delete set null;
create index if not exists social_posts_location_idx on public.social_posts (location_key) where location_key is not null;

notify pgrst, 'reload schema';
