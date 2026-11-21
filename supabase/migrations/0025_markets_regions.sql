-- RayValue global data model, step 1 of 5 (Wave 0 Track B): markets + regions.
-- APPLY ORDER: after 0023 (and 0024, Track A). Independent of 0024. Additive only; nothing existing changes.
--
-- A market is a country RayValue publishes for: its currency, locale, tax-inclusive pricing flag, which solar
-- yield provider covers it, and hemisphere (drives the panel azimuth convention). Regions are the generic
-- state / province / Land / territory inside a market. Seeds ONLY what today's US pages already rely on
-- (US, FL, CA); every other country arrives later as a row whose unknown values are null.
--
-- Provenance: market facts (VAT rate) carry source_url + verified_on + verification, like every fact column;
-- the display rounding unit is an ASSUMPTION and carries a rationale instead of a source.

create table public.markets (
  code                    text primary key check (code ~ '^[A-Z]{2}$'),   -- ISO 3166-1 alpha-2
  name                    text not null check (name <> ''),
  currency                text not null check (currency ~ '^[A-Z]{3}$'),   -- ISO 4217; all calculator maths runs in this currency, no FX
  locale                  text not null check (locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  default_lang            text not null check (default_lang ~ '^[a-z]{2,3}$'),
  yield_provider          text not null check (yield_provider in ('pvwatts', 'pvgis')),  -- one provider per country, never mixed
  hemisphere              text not null check (hemisphere in ('N', 'S')),
  -- Do consumer prices in this market include sales tax / VAT / GST? null = unknown.
  prices_include_tax      boolean,
  vat_rate                numeric check (vat_rate >= 0 and vat_rate < 1),  -- fraction, 0.10 = 10%. null = unknown or no national VAT recorded.
  vat_note                text,
  vat_source_url          text check (vat_source_url ~ '^https?://'),
  vat_verified_on         date,
  vat_verification        text not null default 'unverified' check (vat_verification in ('agent_sourced', 'human_verified', 'unverified')),
  -- Display rounding unit for money (assumption, not a fact): 100 = nearest 100 currency units. null = engine default (100).
  display_round           integer check (display_round > 0),
  display_round_rationale text,
  published               boolean not null default false,
  updated_at              timestamptz not null default now(),
  constraint markets_vat_needs_provenance check (
    vat_rate is null or (vat_source_url is not null and vat_verified_on is not null and vat_verification <> 'unverified')
  ),
  constraint markets_round_needs_rationale check (display_round is null or char_length(coalesce(display_round_rationale, '')) >= 10)
);
comment on table public.markets is 'One row per country RayValue serves. Currency, locale, yield provider and hemisphere are structural; vat_rate is a sourced fact (null until verified); display_round is a rationale-backed assumption.';
comment on column public.markets.yield_provider is 'pvwatts (US, CA) or pvgis (everywhere else). One provider per country: never mix within a country.';
comment on column public.markets.hemisphere is 'S flips the equator-facing azimuth: PVWatts azimuth 0 (north) / PVGIS aspect 180.';
comment on column public.markets.prices_include_tax is 'true when consumer prices quoted in this market include VAT/GST. Cost rows carry their own includes_tax (see cost_ranges, 0026).';

create table public.regions (
  country     text not null references public.markets (code) on update cascade on delete cascade,
  code        text not null check (code ~ '^[A-Z0-9-]{1,8}$'),      -- 'FL', 'CA', 'NSW', 'ON', 'BY'
  name        text not null check (name <> ''),
  slug        text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),  -- URL segment
  tax_note    text,
  published   boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (country, code),
  unique (country, slug)
);
comment on table public.regions is 'State / province / Land / territory within a market. (country, code) is the generic replacement for the FL/CA-only state columns.';

create trigger set_updated_at before update on public.markets for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.regions for each row execute function public.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['markets', 'regions']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    execute format('create policy "Public reference data is readable" on public.%I for select to anon using (true)', t);
  end loop;
end;
$$;

-- Seed: only what the live US pages need. No VAT value for the US (sales tax is state/local; not recorded here).
insert into public.markets (code, name, currency, locale, default_lang, yield_provider, hemisphere, prices_include_tax, published)
values ('US', 'United States', 'USD', 'en-US', 'en', 'pvwatts', 'N', false, true);

insert into public.regions (country, code, name, slug, published) values
  ('US', 'FL', 'Florida', 'florida', true),
  ('US', 'CA', 'California', 'california', true);

notify pgrst, 'reload schema';
