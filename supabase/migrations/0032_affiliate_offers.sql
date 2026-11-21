-- RayValue: affiliate offers + cookieless click log (Wave 0, track D).
--
-- Extends the existing public.offers table (0002, keyed by state, one "lead partner" CTA per state, 0 rows)
-- instead of adding a second table:
--   * the primary key moves from state to a uuid id; state stays UNIQUE where set, so the calculator's
--     existing lookup (state = 'FL' and active) keeps working unchanged;
--   * state becomes optional: affiliate rows are not tied to FL/CA;
--   * new columns describe an affiliate/lead-network offer (program, network, country, category, a redirect
--     destination template, display copy, active window, disclosure text key).
-- The owner edits offers in the Supabase Table Editor. No affiliate ID is in code or in this file.
--
-- affiliate_clicks: one row per click on /go/out/<slug>. NO ip, NO cookie, NO user agent string, NO personal
-- data: only the offer, the page the link was on, a coarse country code, a coarse device class and a timestamp.
-- Written server-side with the service_role key only; anon/authenticated have no access at all.

-- ------------------------------------------------------------------ offers

alter table public.offers drop constraint if exists offers_pkey;
alter table public.offers add column id uuid not null default gen_random_uuid();
alter table public.offers add primary key (id);
alter table public.offers alter column state drop not null;
create unique index offers_state_key on public.offers (state) where state is not null;

alter table public.offers drop constraint if exists offers_check;  -- (not active or url is not null)

alter table public.offers
  add column slug                 text,
  add column kind                 text not null default 'lead_partner',
  add column brand                text,
  add column program              text,
  add column network              text,
  add column country              text,
  add column category             text,
  add column destination_url_template text,
  add column headline             text,
  add column description          text,
  add column price_text           text,
  add column price_source_url     text,
  add column price_verified_on    date,
  add column disclosure_key       text not null default 'affiliate_standard',
  add column starts_at            timestamptz,
  add column ends_at              timestamptz;

alter table public.offers
  add constraint offers_slug_format check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add constraint offers_kind_check check (kind in ('lead_partner', 'affiliate')),
  add constraint offers_country_check check (country is null or country ~ '^[A-Z]{2}$'),
  add constraint offers_category_check check (category is null or category in ('battery', 'portable_power', 'solar_marketplace', 'other')),
  add constraint offers_destination_https check (destination_url_template is null or destination_url_template ~ '^https://'),
  -- Rule 1: a price shown on the site must carry its source and check date. No source, no price.
  add constraint offers_price_provenance check (price_text is null or (price_source_url is not null and price_verified_on is not null)),
  add constraint offers_window_check check (starts_at is null or ends_at is null or ends_at > starts_at),
  -- Affiliate rows are addressed by slug and need a destination; lead-partner rows keep the old url rule.
  add constraint offers_affiliate_shape check (kind <> 'affiliate' or (slug is not null and brand is not null)),
  add constraint offers_active_has_destination check (
    not active or (kind = 'affiliate' and destination_url_template is not null) or (kind = 'lead_partner' and url is not null)
  );
create unique index offers_slug_key on public.offers (slug) where slug is not null;

comment on column public.offers.kind is 'lead_partner = the per-state calculator CTA (url). affiliate = a redirect-link program shown on content pages (destination_url_template).';
comment on column public.offers.destination_url_template is 'https URL with the owner''s affiliate ID already filled in. {slug} and {page} are replaced at click time ({page} = the page path the link was on, URL-encoded) for networks that support a sub-ID.';
comment on column public.offers.disclosure_key is 'Which disclosure wording the site shows above the offer (keys are defined in src/lib/offers/disclosure.ts).';
comment on column public.offers.price_text is 'Shown verbatim when set, e.g. a list price. Requires price_source_url + price_verified_on. Leave null to show no price.';
comment on column public.offers.starts_at is 'Offer is shown from this moment (null = no start limit).';
comment on column public.offers.ends_at is 'Offer stops showing at this moment (null = no end).';

-- Inactive stubs for the four launch brands: the owner fills in destination_url_template (with their
-- affiliate link), headline/description if wanted, then sets active = true. No program is signed up yet.
insert into public.offers (kind, slug, brand, partner_name, category, country, cta_text, active) values
  ('affiliate', 'ecoflow-battery', 'EcoFlow',      'EcoFlow',      'battery', 'US', 'See it at EcoFlow',      false),
  ('affiliate', 'anker-solix',     'Anker SOLIX',  'Anker SOLIX',  'battery', 'US', 'See it at Anker SOLIX',  false),
  ('affiliate', 'jackery-battery', 'Jackery',      'Jackery',      'battery', 'US', 'See it at Jackery',      false),
  ('affiliate', 'bluetti-battery', 'Bluetti',      'Bluetti',      'battery', 'US', 'See it at Bluetti',      false);

-- ------------------------------------------------------------ affiliate_clicks

create table public.affiliate_clicks (
  id          bigint generated always as identity primary key,
  offer_id    uuid not null references public.offers (id) on delete cascade,
  page_path   text check (page_path is null or (page_path ~ '^/' and length(page_path) <= 200)),
  country     text check (country is null or country ~ '^[A-Z]{2}$'),
  ua_class    text not null default 'other' check (ua_class in ('desktop', 'mobile', 'tablet', 'bot', 'other')),
  clicked_at  timestamptz not null default now()
);
comment on table public.affiliate_clicks is 'One row per /go/out/<slug> click. No IP, no cookie, no user agent, no personal data. Insert by the server (service_role) only.';
create index affiliate_clicks_offer_time_idx on public.affiliate_clicks (offer_id, clicked_at desc);
create index affiliate_clicks_time_idx on public.affiliate_clicks (clicked_at desc);

alter table public.affiliate_clicks enable row level security;
revoke all on table public.affiliate_clicks from anon, authenticated;
grant select, insert on table public.affiliate_clicks to service_role;
-- No policies for anon/authenticated: with RLS on, they can neither read nor write. service_role bypasses RLS.
