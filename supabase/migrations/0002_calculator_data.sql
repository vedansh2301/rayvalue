-- RayValue: calculator reference data (rates, costs, assumptions, cities, offers,
-- precomputed PVWatts production). Values live ONLY in these tables and are edited in the
-- Supabase Table Editor; the repo holds schema + validation + logic. DDL only: no data here.
--
-- Access model
--   anon (publishable key, used server-side by the site): SELECT on reference tables, nothing else.
--   authenticated: nothing (the site has no logins).
--   service_role (secret key, admin scripts only): full access.
--   rate_alert_subscribers (0001) is not touched.
-- Explicit grants are used because new public tables are no longer exposed to the Data API by
-- default on newer projects, while this project's default privileges still grant anon everything.
--
-- Provenance rules (also enforced again in code by the Zod schemas, which run on every load):
--   facts carry source_url + verified_on + verification ('agent_sourced'|'human_verified'|'unverified');
--   a row holding a number must have source_url and verified_on and must not be 'unverified';
--   assumptions carry a rationale instead of a source.

-- ------------------------------------------------------------------ helpers

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------- utilities

create table public.utilities (
  id                         text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  display_order              smallint not null default 100,
  name                       text not null check (name <> ''),
  state                      text not null check (state in ('FL', 'CA')),
  metering_type              text not null check (metering_type in ('retail_net_metering', 'nem3_net_billing')),
  rate_schedule              text not null check (rate_schedule <> ''),
  rate_type                  text not null check (rate_type in ('tiered', 'tou_summary')),
  fixed_monthly_charge       numeric check (fixed_monthly_charge >= 0),
  fixed_charge_note          text,
  minimum_monthly_bill       numeric check (minimum_monthly_bill >= 0),
  minimum_bill_basis         text check (minimum_bill_basis in ('base_charges', 'total_bill', 'none', 'not_applicable')),
  minimum_bill_note          text,
  avg_export_credit_per_kwh  numeric check (avg_export_credit_per_kwh >= 0),
  baseline_credit_per_kwh    numeric check (baseline_credit_per_kwh >= 0),
  rate_note                  text,
  tou_note                   text,
  source_url                 text check (source_url ~ '^https?://'),
  verified_on                date,
  verification               text not null default 'unverified' check (verification in ('agent_sourced', 'human_verified', 'unverified')),
  source_caveat              text,
  -- Published residential class-average rate (tou_summary utilities only), with its OWN provenance.
  -- The record exists iff avg_rate_unit is not null.
  avg_rate_low               numeric check (avg_rate_low >= 0),
  avg_rate_likely            numeric check (avg_rate_likely >= 0),
  avg_rate_high              numeric check (avg_rate_high >= 0),
  avg_rate_unit              text,
  avg_rate_note              text,
  avg_rate_source_url        text check (avg_rate_source_url ~ '^https?://'),
  avg_rate_verified_on       date,
  avg_rate_verification      text check (avg_rate_verification in ('agent_sourced', 'human_verified', 'unverified')),
  updated_at                 timestamptz not null default now(),
  constraint utilities_numeric_needs_provenance check (
    (fixed_monthly_charge is null and minimum_monthly_bill is null and avg_export_credit_per_kwh is null and baseline_credit_per_kwh is null)
    or (source_url is not null and verified_on is not null and verification <> 'unverified')
  ),
  constraint utilities_avg_rate_record check (
    (avg_rate_unit is null and avg_rate_low is null and avg_rate_likely is null and avg_rate_high is null
      and avg_rate_note is null and avg_rate_source_url is null and avg_rate_verified_on is null and avg_rate_verification is null)
    or (avg_rate_unit is not null and avg_rate_verification is not null)
  ),
  constraint utilities_avg_rate_needs_provenance check (
    (avg_rate_low is null and avg_rate_likely is null and avg_rate_high is null)
    or (avg_rate_source_url is not null and avg_rate_verified_on is not null and avg_rate_verification <> 'unverified')
  ),
  constraint utilities_avg_rate_order check (
    (avg_rate_low is null or avg_rate_likely is null or avg_rate_low <= avg_rate_likely)
    and (avg_rate_likely is null or avg_rate_high is null or avg_rate_likely <= avg_rate_high)
    and (avg_rate_low is null or avg_rate_high is null or avg_rate_low <= avg_rate_high)
  ),
  constraint utilities_tiered_has_no_avg_rate check (rate_type <> 'tiered' or avg_rate_unit is null)
);
comment on table public.utilities is 'One row per utility rate plan used by the calculator. Facts: source_url + verified_on + verification. Tiered plans have rows in utility_tier_sets/utility_tiers; tou_summary plans have rows in utility_tou_rates and an avg_rate_* record.';
comment on column public.utilities.display_order is 'Sort order for lists on the site (lower first).';
comment on column public.utilities.fixed_monthly_charge is 'USD per month (customer / base services charge). null = unknown (listed in todo_verify).';
comment on column public.utilities.minimum_monthly_bill is 'USD per month; needs minimum_bill_basis base_charges or total_bill.';
comment on column public.utilities.minimum_bill_basis is 'base_charges | total_bill | none | not_applicable (CA) | null = unknown.';
comment on column public.utilities.avg_export_credit_per_kwh is 'CA only: USD per kWh exported under net billing. null = unknown.';
comment on column public.utilities.baseline_credit_per_kwh is 'CA only: USD per kWh credit on baseline usage.';
comment on column public.utilities.avg_rate_likely is 'USD per kWh: published residential class-average rate (tou_summary only); own provenance in avg_rate_source_url / avg_rate_verified_on / avg_rate_verification.';
comment on column public.utilities.source_caveat is 'Set when the source is undated, old or inconsistent; listed first in todo_verify.';

create table public.utility_tier_sets (
  id          uuid primary key default gen_random_uuid(),
  utility_id  text not null references public.utilities (id) on update cascade on delete cascade,
  position    smallint not null default 0 check (position >= 0),
  season      text not null check (season in ('all_year', 'summer', 'winter')),
  months      smallint[] not null check (cardinality(months) between 1 and 12 and months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]),
  updated_at  timestamptz not null default now(),
  unique (utility_id, season),
  unique (utility_id, position)
);
comment on table public.utility_tier_sets is 'Seasonal tier structures of tiered utilities (FPL/TECO: one all_year set; Duke: summer + winter). Months across a utility''s sets must cover 1-12 exactly once (checked in code). Provenance = the parent utility row.';
comment on column public.utility_tier_sets.months is 'Calendar months 1-12 this set applies to.';

create table public.utility_tiers (
  id                 uuid primary key default gen_random_uuid(),
  tier_set_id        uuid not null references public.utility_tier_sets (id) on delete cascade,
  position           smallint not null check (position >= 0),
  up_to_kwh          numeric check (up_to_kwh > 0),
  rate_per_kwh       numeric check (rate_per_kwh >= 0),
  base_rate_per_kwh  numeric check (base_rate_per_kwh >= 0),
  updated_at         timestamptz not null default now(),
  unique (tier_set_id, position),
  check (base_rate_per_kwh is null or rate_per_kwh is null or base_rate_per_kwh <= rate_per_kwh)
);
comment on table public.utility_tiers is 'Tiers of one tier set, ordered by position (0 = first). Provenance = the parent utility row.';
comment on column public.utility_tiers.up_to_kwh is 'Monthly tier ceiling in kWh; null only on the last (open-ended) tier.';
comment on column public.utility_tiers.rate_per_kwh is 'All-in USD per kWh for usage in this tier.';
comment on column public.utility_tiers.base_rate_per_kwh is 'USD per kWh, base energy part only (excludes fuel/clauses); needed when the minimum bill is on base charges.';

create table public.utility_tou_rates (
  id            uuid primary key default gen_random_uuid(),
  utility_id    text not null references public.utilities (id) on update cascade on delete cascade,
  position      smallint not null default 0 check (position >= 0),
  season        text not null check (season in ('summer', 'winter')),
  period        text not null check (period in ('peak', 'mid_peak', 'off_peak', 'super_off_peak')),
  day_type      text not null check (day_type in ('all', 'weekday', 'weekend')),
  months        smallint[] check (months is null or (cardinality(months) between 1 and 12 and months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[])),
  hours         text,
  rate_per_kwh  numeric check (rate_per_kwh >= 0),
  updated_at    timestamptz not null default now(),
  unique (utility_id, season, period, day_type),
  unique (utility_id, position)
);
comment on table public.utility_tou_rates is 'Time-of-use rates as read from the tariff (tou_summary utilities). Provenance = the parent utility row.';
comment on column public.utility_tou_rates.rate_per_kwh is 'All-in USD per kWh.';
comment on column public.utility_tou_rates.months is 'Calendar months 1-12, or null where the source does not state them.';
comment on column public.utility_tou_rates.hours is 'Human-readable hours (display only), e.g. 4-9 p.m.';

-- -------------------------------------------------------------------- costs

create table public.cost_ranges (
  state         text not null check (state in ('FL', 'CA')),
  item          text not null check (item in ('installed_cost_per_watt', 'battery_installed_cost')),
  low           numeric check (low >= 0),
  likely        numeric check (likely >= 0),
  high          numeric check (high >= 0),
  unit          text not null check (unit <> ''),
  note          text,
  source_url    text check (source_url ~ '^https?://'),
  verified_on   date,
  verification  text not null default 'unverified' check (verification in ('agent_sourced', 'human_verified', 'unverified')),
  updated_at    timestamptz not null default now(),
  primary key (state, item),
  constraint cost_ranges_order check (
    (low is null or likely is null or low <= likely)
    and (likely is null or high is null or likely <= high)
    and (low is null or high is null or low <= high)
  ),
  constraint cost_ranges_provenance check (
    case when low is null and likely is null and high is null
      then verification = 'unverified' and source_url is null and verified_on is null
      else source_url is not null and verified_on is not null and verification <> 'unverified'
    end
  )
);
comment on table public.cost_ranges is 'Sourced low / likely / high installed costs per state. Null bounds are filled by the engine with model_assumptions.missing_range_spread and listed in todo_verify.';
comment on column public.cost_ranges.likely is 'installed_cost_per_watt: USD per watt DC; battery_installed_cost: USD per battery system (see unit).';

-- -------------------------------------------------------------- assumptions

create table public.model_assumptions (
  id          uuid primary key default gen_random_uuid(),
  key         text not null check (key ~ '^[a-z0-9_]+$'),
  state       text check (state in ('FL', 'CA')),
  value       jsonb not null check (jsonb_typeof(value) = 'object'),
  unit        text,
  rationale   text not null check (char_length(rationale) >= 10),
  updated_at  timestamptz not null default now(),
  constraint model_assumptions_key_state unique nulls not distinct (key, state)
);
comment on table public.model_assumptions is 'Product choices (not facts): each has a rationale, never a source. state null = applies to both states; a row with state FL/CA overrides the null-state row for that state. value holds the numeric fields as a JSON object (shape checked in code by AssumptionsSchema).';
comment on column public.model_assumptions.value is 'JSON object, e.g. {"value": 25} or {"low": 0.9, "high": 1.0}; see unit.';

-- ------------------------------------------------------------------- cities

create table public.cities (
  state                text not null check (state in ('FL', 'CA')),
  slug                 text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  display_order        smallint not null default 100,
  name                 text not null check (name <> ''),
  lat                  numeric not null check (lat between -90 and 90),
  lon                  numeric not null check (lon between -180 and 180),
  coords_zcta          text not null check (coords_zcta ~ '^\d{5}$'),
  coords_note          text not null,
  coords_source_url    text not null check (coords_source_url ~ '^https?://'),
  coords_verified_on   date not null,
  default_utility_id   text not null references public.utilities (id) on update cascade,
  utility_confidence   text not null check (utility_confidence in ('city', 'county', 'indirect')),
  utility_source_url   text not null check (utility_source_url ~ '^https?://'),
  utility_source_note  text not null check (utility_source_note <> ''),
  published            boolean not null default false,
  local_notes          text[] not null default '{}',
  intro_md             text,
  updated_at           timestamptz not null default now(),
  primary key (state, slug)
);
comment on table public.cities is 'City pages and the ZIP -> nearest-city mapping. published = false keeps a page noindex and out of the sitemap until the owner reviews it.';
comment on column public.cities.lat is 'Degrees; Census ZCTA internal point of coords_zcta, rounded to 4 decimals.';
comment on column public.cities.utility_confidence is 'city = source names the city; county = names only its county; indirect = inferred from a related list.';
comment on column public.cities.intro_md is 'Owner-written intro (Markdown). null = page shows a TODO placeholder.';

-- --------------------------------------------------- precomputed production

create table public.pvwatts_city_production (
  state               text not null,
  slug                text not null,
  losses              numeric not null check (losses between 0 and 60),
  annual_kwh_per_kw   numeric not null check (annual_kwh_per_kw > 0),
  monthly_kwh_per_kw  numeric[] not null check (cardinality(monthly_kwh_per_kw) = 12),
  fetched_on          date not null,
  source_url          text not null check (source_url ~ '^https?://'),
  endpoint            text not null check (endpoint ~ '^https?://'),
  params              jsonb not null check (jsonb_typeof(params) = 'object'),
  dataset_note        text not null,
  key_kind            text not null check (key_kind in ('DEMO_KEY', 'api_key')),
  updated_at          timestamptz not null default now(),
  primary key (state, slug, losses),
  foreign key (state, slug) references public.cities (state, slug) on update cascade on delete cascade
);
comment on table public.pvwatts_city_production is 'PVWatts v8 output for a 1 kW DC system at each city and PVWatts losses percent (written by scripts/precompute-pvwatts.mjs). Used when the live PVWatts call is unavailable. A missing row = not fetched yet (listed in todo_verify).';
comment on column public.pvwatts_city_production.annual_kwh_per_kw is 'kWh AC per year per kW DC.';
comment on column public.pvwatts_city_production.monthly_kwh_per_kw is 'kWh AC per month per kW DC, January..December.';
comment on column public.pvwatts_city_production.losses is 'PVWatts system losses percent (matches model_assumptions.pvwatts_system_loss_pct).';

-- ------------------------------------------------------------------- offers

create table public.offers (
  state         text primary key check (state in ('FL', 'CA')),
  partner_name  text not null check (partner_name <> ''),
  url           text check (url ~ '^https://'),
  cta_text      text not null check (cta_text <> ''),
  active        boolean not null default false,
  updated_at    timestamptz not null default now(),
  check (not active or url is not null)
);
comment on table public.offers is 'Affiliate / partner offer shown on calculator results per state. Only active rows with a url are shown.';

-- ----------------------------------------------------------------- triggers

create trigger set_updated_at before update on public.utilities for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.utility_tier_sets for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.utility_tiers for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.utility_tou_rates for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.cost_ranges for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.model_assumptions for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.cities for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.pvwatts_city_production for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.offers for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ RLS + grants

do $$
declare t text;
begin
  foreach t in array array['utilities', 'utility_tier_sets', 'utility_tiers', 'utility_tou_rates', 'cost_ranges',
                           'model_assumptions', 'cities', 'pvwatts_city_production', 'offers']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    execute format('create policy "Public reference data is readable" on public.%I for select to anon using (true)', t);
  end loop;
end;
$$;

-- --------------------------------------------------------------- todo_verify

-- Everything the owner should check or fill. Paths use the same spelling as the calculator's
-- missing_data list: utilities[<id>]..., cost_ranges[<state>/<item>].<bound>.
create view public.todo_verify with (security_invoker = true) as
with
u as (select * from public.utilities),
slots as (
  -- tier rates (base rate only when the minimum bill is on base charges)
  select 'utilities[' || u.id || '].tier_sets[' || s.season || '].tiers[' || t.position || '].rate_per_kwh' as path,
         'utility_tiers' as table_name, t.rate_per_kwh as value, null::text as note,
         u.source_url, u.verified_on, u.verification, u.display_order as o1, s.position as o2, t.position * 2 as o3
  from u join public.utility_tier_sets s on s.utility_id = u.id join public.utility_tiers t on t.tier_set_id = s.id
  where u.rate_type = 'tiered'
  union all
  select 'utilities[' || u.id || '].tier_sets[' || s.season || '].tiers[' || t.position || '].base_rate_per_kwh',
         'utility_tiers', t.base_rate_per_kwh, null, u.source_url, u.verified_on, u.verification, u.display_order, s.position, t.position * 2 + 1
  from u join public.utility_tier_sets s on s.utility_id = u.id join public.utility_tiers t on t.tier_set_id = s.id
  where u.rate_type = 'tiered' and u.minimum_bill_basis = 'base_charges'
  union all
  select 'utilities[' || u.id || '].tou_rates[' || r.season || '/' || r.period || '/' || r.day_type || '].rate_per_kwh',
         'utility_tou_rates', r.rate_per_kwh, null, u.source_url, u.verified_on, u.verification, u.display_order, 0, r.position
  from u join public.utility_tou_rates r on r.utility_id = u.id
  where u.rate_type = 'tou_summary'
  union all
  select 'utilities[' || u.id || '].avg_rate_per_kwh.' || b.k, 'utilities', b.v, null,
         u.avg_rate_source_url, u.avg_rate_verified_on, u.avg_rate_verification, u.display_order, 1, b.n
  from u cross join lateral (values ('low', u.avg_rate_low, 0), ('likely', u.avg_rate_likely, 1), ('high', u.avg_rate_high, 2)) as b(k, v, n)
  where u.rate_type = 'tou_summary'
  union all
  select 'utilities[' || u.id || '].fixed_monthly_charge', 'utilities', u.fixed_monthly_charge,
         case when u.fixed_monthly_charge is null then u.fixed_charge_note end,
         u.source_url, u.verified_on, u.verification, u.display_order, 2, 0
  from u
  union all
  select 'utilities[' || u.id || '].minimum_monthly_bill', 'utilities', u.minimum_monthly_bill,
         case when u.minimum_monthly_bill is null then u.minimum_bill_note end,
         u.source_url, u.verified_on, u.verification, u.display_order, 2, 1
  from u where u.state = 'FL' and u.minimum_bill_basis is distinct from 'none'
  union all
  select 'utilities[' || u.id || '].baseline_credit_per_kwh', 'utilities', u.baseline_credit_per_kwh, null,
         u.source_url, u.verified_on, u.verification, u.display_order, 2, 2
  from u where u.state = 'CA'
  union all
  select 'utilities[' || u.id || '].avg_export_credit_per_kwh', 'utilities', u.avg_export_credit_per_kwh, null,
         u.source_url, u.verified_on, u.verification, u.display_order, 2, 3
  from u where u.state = 'CA'
  union all
  select 'cost_ranges[' || c.state || '/' || c.item || '].' || b.k, 'cost_ranges', b.v, null,
         c.source_url, c.verified_on, c.verification,
         1000 + case c.state when 'FL' then 0 else 1 end, case c.item when 'installed_cost_per_watt' then 0 else 1 end, b.n
  from public.cost_ranges c
  cross join lateral (values ('low', c.low, 0), ('likely', c.likely, 1), ('high', c.high, 2)) as b(k, v, n)
),
losses as (
  select distinct (e.value)::numeric as losses
  from public.model_assumptions a cross join lateral jsonb_each(a.value) e
  where a.key = 'pvwatts_system_loss_pct' and a.state is null and jsonb_typeof(e.value) = 'number'
)
select 1 as section, 'stale_source' as category, 'utilities[' || u.id || ']' as path, 'utilities' as table_name,
       null::numeric as value, u.name || ': ' || u.source_caveat as detail, u.source_url, u.verified_on, u.verification,
       array[u.display_order, 0, 0]::int[] as sort_key
from u where u.source_caveat is not null
union all
select 2, 'null_value', s.path, s.table_name, null, s.note, s.source_url, s.verified_on, s.verification, array[s.o1, s.o2, s.o3]::int[]
from slots s where s.value is null
union all
select 3, 'missing_production', c.state || '/' || c.slug || ' @ losses=' || l.losses, 'pvwatts_city_production',
       null, null, null, null, null, array[c.display_order, l.losses::int, 0]::int[]
from public.cities c cross join losses l
where not exists (select 1 from public.pvwatts_city_production p where p.state = c.state and p.slug = c.slug and p.losses = l.losses)
union all
select 4, 'agent_sourced', s.path, s.table_name, s.value, null, s.source_url, s.verified_on, s.verification, array[s.o1, s.o2, s.o3]::int[]
from slots s where s.value is not null and s.verification = 'agent_sourced'
union all
select 5, 'human_verified', s.path, s.table_name, s.value, null, s.source_url, s.verified_on, s.verification, array[s.o1, s.o2, s.o3]::int[]
from slots s where s.value is not null and s.verification = 'human_verified'
union all
select 6, 'assumption', a.key || coalesce('[' || a.state || ']', ''), 'model_assumptions', null,
       a.value::text || E'\n' || a.rationale, null, null, null, array[0, 0, 0]::int[]
from public.model_assumptions a
union all
select 7, 'weak_city_mapping', c.state || '/' || c.slug, 'cities', null,
       c.default_utility_id || ' [' || c.utility_confidence || ']: ' || c.utility_source_note, c.utility_source_url, null, null,
       array[c.display_order, 0, 0]::int[]
from public.cities c where c.utility_confidence <> 'city';

comment on view public.todo_verify is 'What to check or fill, generated from the data. sections: 1 stale_source, 2 null_value, 3 missing_production, 4 agent_sourced, 5 human_verified, 6 assumption, 7 weak_city_mapping. `npm run todo:verify` turns it into docs/TODO-VERIFY.md.';

revoke all on table public.todo_verify from anon, authenticated;
grant select on table public.todo_verify to service_role;

notify pgrst, 'reload schema';
