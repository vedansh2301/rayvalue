-- RayValue global data model, step 2 of 5: country + region_code on the existing tables; FL/CA-only checks relaxed.
-- APPLY ORDER: after 0025. Additive and backward compatible: every existing row becomes country 'US' and the
-- legacy `state` column, primary keys and PostgREST filters (state=eq.FL) keep working unchanged.
--
-- Approach (rvplan/06 §4.2): `state` stays as the legacy key; `region_code` is the generic key. A trigger keeps
-- them in step (insert either; the other is filled), so src/lib/db/repo.ts and map.ts need no change. The
-- (country, region_code) pair is a foreign key to regions, which replaces `check (state in ('FL','CA'))`.
-- New unique keys (country, region_code, ...) sit beside the old primary keys; the primary keys are swapped
-- only in a later cleanup migration, after the code reads the new columns.
--
-- NOT touched here (deliberately): leads / buyers (phone, postal-code and consent rules are a separate,
-- legal-review migration), fx_rates (reporting only).
--
-- Caveat for the first non-US rows: repo.ts reads cost_ranges and model_assumptions without a country filter.
-- Add non-US rows only together with a `country=eq.US` filter in the existing US loaders (one line each).

-- ---------------------------------------------------------------- sync trigger

create or replace function public.sync_region_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.region_code is null then new.region_code := new.state; end if;
  if new.state is null then new.state := new.region_code; end if;
  return new;
end;
$$;
revoke all on function public.sync_region_state() from public, anon, authenticated;

-- ---------------------------------------------------------------- utilities

alter table public.utilities
  add column country text not null default 'US' references public.markets (code) on update cascade,
  add column region_code text;
update public.utilities set region_code = state;
alter table public.utilities alter column region_code set not null;
alter table public.utilities drop constraint utilities_state_check;
alter table public.utilities drop constraint utilities_metering_type_check;
alter table public.utilities add constraint utilities_metering_type_check
  check (metering_type in ('retail_net_metering', 'nem3_net_billing', 'net_billing', 'feed_in', 'gross_metering', 'none', 'br_fio_b'));
alter table public.utilities add constraint utilities_region_fk
  foreign key (country, region_code) references public.regions (country, code) on update cascade;
create trigger sync_region_state before insert or update on public.utilities for each row execute function public.sync_region_state();
comment on column public.utilities.country is 'Market (markets.code). US for every row that existed before 0026.';
comment on column public.utilities.region_code is 'Generic region within the market; equals state for US rows (kept in sync by trigger).';
comment on column public.utilities.metering_type is 'Legacy; superseded by export_policy_id (0027). Kept so the US calculator keeps working until it switches.';

-- ---------------------------------------------------------------- cost_ranges

alter table public.cost_ranges
  add column country text not null default 'US' references public.markets (code) on update cascade,
  add column region_code text,
  add column includes_tax boolean;
update public.cost_ranges set region_code = state;
alter table public.cost_ranges alter column region_code set not null;
alter table public.cost_ranges drop constraint cost_ranges_state_check;
alter table public.cost_ranges add constraint cost_ranges_region_fk
  foreign key (country, region_code) references public.regions (country, code) on update cascade;
alter table public.cost_ranges add constraint cost_ranges_country_region_item_key unique (country, region_code, item);
-- Non-US rows holding a number must state whether the price includes tax (US rows keep today's null).
alter table public.cost_ranges add constraint cost_ranges_tax_flag_outside_us check (
  country = 'US' or (low is null and likely is null and high is null) or includes_tax is not null
);
create trigger sync_region_state before insert or update on public.cost_ranges for each row execute function public.sync_region_state();
comment on column public.cost_ranges.includes_tax is 'true = price includes VAT/GST/sales tax; false = ex-tax (engine adds markets.vat_rate); null = unknown. Required for non-US rows that hold a number.';
comment on column public.cost_ranges.unit is 'Unit text; the money unit is the market currency (markets.currency).';

-- ---------------------------------------------------------------- model_assumptions

alter table public.model_assumptions
  add column country text not null default 'US' references public.markets (code) on update cascade,
  add column region_code text;
update public.model_assumptions set region_code = state;
alter table public.model_assumptions drop constraint model_assumptions_state_check;
alter table public.model_assumptions drop constraint model_assumptions_key_state;
alter table public.model_assumptions add constraint model_assumptions_key_country_state unique nulls not distinct (key, country, state);
alter table public.model_assumptions add constraint model_assumptions_region_fk
  foreign key (country, region_code) references public.regions (country, code) on update cascade;
-- region_code stays null for a country-wide assumption (state null); the trigger copies whichever side is set.
create trigger sync_region_state before insert or update on public.model_assumptions for each row execute function public.sync_region_state();
comment on column public.model_assumptions.country is 'Market the assumption applies to. A row with state/region null applies to the whole country; a region row overrides it.';

-- ---------------------------------------------------------------- cities

alter table public.cities
  add column country text not null default 'US' references public.markets (code) on update cascade,
  add column region_code text,
  add column postal_system text;
update public.cities set region_code = state;
alter table public.cities alter column region_code set not null;
alter table public.cities drop constraint cities_state_check;
alter table public.cities drop constraint cities_coords_zcta_check;
alter table public.cities alter column coords_zcta drop not null;
alter table public.cities add constraint cities_coords_zcta_check check (country <> 'US' or coords_zcta ~ '^\d{5}$');
alter table public.cities add constraint cities_region_fk
  foreign key (country, region_code) references public.regions (country, code) on update cascade;
alter table public.cities add constraint cities_country_region_slug_key unique (country, region_code, slug);
create trigger sync_region_state before insert or update on public.cities for each row execute function public.sync_region_state();
comment on column public.cities.coords_zcta is 'US: the ZIP whose Census ZCTA point gives lat/lon (5 digits, required). Non-US: the postal area code of the source, or null.';
comment on column public.cities.postal_system is 'Postal system of the code in coords_zcta: US-ZCTA, CA-FSA, AU-POA, ... null = US-ZCTA.';

-- ---------------------------------------------------------------- pvwatts_city_production

alter table public.pvwatts_city_production
  add column country text not null default 'US' references public.markets (code) on update cascade,
  add column provider text not null default 'pvwatts_v8' check (provider in ('pvwatts_v8', 'pvgis_5_3'));
-- key_kind is PVWatts-specific (DEMO_KEY | api_key); PVGIS needs no key.
alter table public.pvwatts_city_production drop constraint pvwatts_city_production_key_kind_check;
alter table public.pvwatts_city_production add constraint pvwatts_city_production_key_kind_check
  check (key_kind in ('DEMO_KEY', 'api_key', 'none'));
comment on column public.pvwatts_city_production.provider is 'pvwatts_v8 (US, CA) or pvgis_5_3 (everywhere else); matches markets.yield_provider, never mixed within a country. The table keeps its legacy name until a cleanup migration renames it city_production.';

-- ---------------------------------------------------------------- offers, city_housing

alter table public.offers
  add column country text not null default 'US' references public.markets (code) on update cascade,
  add column region_code text;
update public.offers set region_code = state;
alter table public.offers alter column region_code set not null;
alter table public.offers drop constraint offers_state_check;
alter table public.offers add constraint offers_region_fk
  foreign key (country, region_code) references public.regions (country, code) on update cascade;
alter table public.offers add constraint offers_country_region_key unique (country, region_code);
create trigger sync_region_state before insert or update on public.offers for each row execute function public.sync_region_state();

alter table public.city_housing
  add column country text not null default 'US' references public.markets (code) on update cascade;
comment on column public.city_housing.country is 'Always US today: the table holds Census ACS data (census_place_geoid stays 7 digits).';

notify pgrst, 'reload schema';
