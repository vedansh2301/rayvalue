-- RayValue international city / place pages (first: GB, DE, AU).
-- APPLY ORDER: after 0025 (markets, regions). Additive only; nothing existing changes. Not applied by this commit.
--
--   places       one row per city / local-authority page: (country, region_code, slug), coordinates and an optional
--                population, each with its source. `published` is false by default (CLAUDE.md rule 9): a place is
--                public only after the owner reviews it.
--   place_facts  one row per sourced number or label shown on a place page. Every row names its source_url,
--                publisher and verified_on, and a primary/secondary confidence. The page renders ONLY from these
--                rows; nothing is typed in code. A fact that describes a wider area than the place (a regional
--                price-cap rate, a regional install cost, a distribution network) says so in `scope` / `scope_label`.
--
-- RLS: anon may SELECT a place only while it is published, and its facts only while their place is published.
-- service_role (the import script) has full access.
--
-- Seeds: the three markets (GB, DE, AU) and their regions. VAT / GST is left NULL: a single national rate is not
-- unambiguous in these markets (GB and DE zero-rate domestic solar for a limited period; AU GST is shown on
-- quotes by the installer). It is entered later with a source_url + verified_on, like every other fact.

create table public.places (
  id                      uuid primary key default gen_random_uuid(),
  country                 text not null,
  region_code             text not null,
  slug                    text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name                    text not null check (name <> ''),
  lat                     numeric check (lat between -90 and 90),
  lon                     numeric check (lon between -180 and 180),
  coord_source_url        text check (coord_source_url ~ '^https?://'),
  population              integer check (population >= 0),
  population_year         smallint,
  population_source_url   text check (population_source_url ~ '^https?://'),
  published               boolean not null default false,
  updated_at              timestamptz not null default now(),
  unique (country, region_code, slug),
  foreign key (country, region_code) references public.regions (country, code) on update cascade on delete cascade,
  constraint places_coords_pair check ((lat is null) = (lon is null)),
  constraint places_coords_need_source check (lat is null or coord_source_url is not null),
  constraint places_population_need_source check (population is null or (population_source_url is not null and population_year is not null))
);
comment on table public.places is 'City / local-authority pages for non-US markets. published=false by default (rule 9); the site additionally requires >= 3 distinct sourced sections before a published place renders.';
create index places_published_idx on public.places (country, region_code) where published;

create table public.place_facts (
  id           uuid primary key default gen_random_uuid(),
  place_id     uuid not null references public.places (id) on update cascade on delete cascade,
  key          text not null check (key ~ '^[a-z0-9_]+$'),
  value_num    numeric,
  value_text   text,
  unit         text not null default '',
  -- '' when the fact has no period; '2021-03-21' (a date), '2026-10-01/2026-12-31' (an interval) or 'm01'..'m12' (a month).
  period       text not null default '',
  scope        text not null default 'place' check (scope in ('place', 'region', 'network')),
  scope_label  text,
  source_url   text check (source_url ~ '^https?://'),
  publisher    text,
  verified_on  date,
  confidence   text not null default 'primary' check (confidence in ('primary', 'secondary')),
  status       text not null default 'agent_sourced' check (status in ('agent_sourced', 'human_verified', 'unverified')),
  note         text,
  updated_at   timestamptz not null default now(),
  unique (place_id, key, period, unit),
  constraint place_facts_has_value check (value_num is not null or value_text is not null),
  constraint place_facts_need_provenance check (status = 'unverified' or (source_url is not null and verified_on is not null)),
  constraint place_facts_scope_label check (scope = 'place' or scope_label is not null)
);
comment on table public.place_facts is 'Sourced facts for place pages. value_num for numbers, value_text for labels. Rows with status=unverified or without source_url + verified_on are never counted toward the 3-section gate.';
comment on column public.place_facts.scope is 'place = about this place; region / network = a wider-area figure shown with scope_label (for example the Ofgem price-cap region).';
create index place_facts_place_idx on public.place_facts (place_id);

create trigger set_updated_at before update on public.places for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.place_facts for each row execute function public.set_updated_at();

alter table public.places enable row level security;
alter table public.place_facts enable row level security;
revoke all on table public.places from anon, authenticated;
revoke all on table public.place_facts from anon, authenticated;
grant select on table public.places to anon;
grant select on table public.place_facts to anon;
grant select, insert, update, delete on table public.places to service_role;
grant select, insert, update, delete on table public.place_facts to service_role;

create policy "Published places are readable" on public.places for select to anon using (published);
create policy "Facts of published places are readable" on public.place_facts for select to anon
  using (exists (select 1 from public.places p where p.id = place_facts.place_id and p.published));

-- ------------------------------------------------------------------------------------------------ seeds

insert into public.markets (code, name, currency, locale, default_lang, yield_provider, hemisphere, prices_include_tax, published) values
  ('GB', 'United Kingdom', 'GBP', 'en-GB', 'en', 'pvgis', 'N', null, false),
  ('DE', 'Germany',        'EUR', 'de-DE', 'de', 'pvgis', 'N', null, false),
  ('AU', 'Australia',      'AUD', 'en-AU', 'en', 'pvgis', 'S', null, false)
on conflict (code) do nothing;

insert into public.regions (country, code, name, slug, published) values
  ('GB', 'NE',  'North East',               'north-east', false),
  ('GB', 'NW',  'North West',               'north-west', false),
  ('GB', 'YH',  'Yorkshire and the Humber', 'yorkshire-and-the-humber', false),
  ('GB', 'EM',  'East Midlands',            'east-midlands', false),
  ('GB', 'WM',  'West Midlands',            'west-midlands', false),
  ('GB', 'EE',  'East of England',          'east-of-england', false),
  ('GB', 'LON', 'London',                   'london', false),
  ('GB', 'SE',  'South East',               'south-east', false),
  ('GB', 'SW',  'South West',               'south-west', false),
  ('GB', 'WLS', 'Wales',                    'wales', false),
  ('GB', 'SCT', 'Scotland',                 'scotland', false),
  ('GB', 'NIR', 'Northern Ireland',         'northern-ireland', false),
  ('DE', 'SH',  'Schleswig-Holstein',       'schleswig-holstein', false),
  ('DE', 'HH',  'Hamburg',                  'hamburg', false),
  ('DE', 'NI',  'Niedersachsen',            'niedersachsen', false),
  ('DE', 'HB',  'Bremen',                   'bremen', false),
  ('DE', 'NW',  'Nordrhein-Westfalen',      'nordrhein-westfalen', false),
  ('DE', 'HE',  'Hessen',                   'hessen', false),
  ('DE', 'RP',  'Rheinland-Pfalz',          'rheinland-pfalz', false),
  ('DE', 'BW',  'Baden-Württemberg',        'baden-wuerttemberg', false),
  ('DE', 'BY',  'Bayern',                   'bayern', false),
  ('DE', 'SL',  'Saarland',                 'saarland', false),
  ('DE', 'BE',  'Berlin',                   'berlin', false),
  ('DE', 'BB',  'Brandenburg',              'brandenburg', false),
  ('DE', 'MV',  'Mecklenburg-Vorpommern',   'mecklenburg-vorpommern', false),
  ('DE', 'SN',  'Sachsen',                  'sachsen', false),
  ('DE', 'ST',  'Sachsen-Anhalt',           'sachsen-anhalt', false),
  ('DE', 'TH',  'Thüringen',                'thueringen', false),
  ('AU', 'NSW', 'New South Wales',          'nsw', false),
  ('AU', 'VIC', 'Victoria',                 'vic', false),
  ('AU', 'QLD', 'Queensland',               'qld', false),
  ('AU', 'SA',  'South Australia',          'sa', false),
  ('AU', 'WA',  'Western Australia',        'wa', false),
  ('AU', 'TAS', 'Tasmania',                 'tas', false),
  ('AU', 'ACT', 'Australian Capital Territory', 'act', false),
  ('AU', 'NT',  'Northern Territory',       'nt', false)
on conflict (country, code) do nothing;

notify pgrst, 'reload schema';
