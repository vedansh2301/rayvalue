-- City housing facts for the city pages ("Homes in <city>"): US Census Bureau American Community Survey 5-year
-- estimates for the Census place (city or CDP) of each city page. Facts, so each row carries source_url, verified_on
-- and verification; a null value means "not available" and the page leaves that line out.
--
-- APPLY ORDER: after 0022. Replaces the todo_verify view (0019 definition + the city_housing slots), so the new
-- values are listed by `npm run todo:verify` for owner sign-off.

create table if not exists public.city_housing (
  state                  text not null,
  slug                   text not null,
  census_place_geoid     text not null check (census_place_geoid ~ '^\d{7}$'),
  census_place_name      text not null check (census_place_name <> ''),
  acs_period             text not null check (acs_period ~ '^\d{4}-\d{4}$'),
  housing_units          integer check (housing_units >= 0),
  owner_occupied_pct     numeric(4,1) check (owner_occupied_pct between 0 and 100),
  one_unit_detached_pct  numeric(4,1) check (one_unit_detached_pct between 0 and 100),
  median_year_built      smallint check (median_year_built between 1900 and 2100),
  median_home_value      integer check (median_home_value >= 0),
  source_url             text not null check (source_url ~ '^https?://'),
  data_url               text not null check (data_url ~ '^https?://'),
  verified_on            date not null,
  verification           text not null default 'agent_sourced' check (verification in ('agent_sourced', 'human_verified', 'unverified')),
  note                   text not null,
  updated_at             timestamptz not null default now(),
  primary key (state, slug),
  foreign key (state, slug) references public.cities (state, slug) on update cascade on delete cascade
);
comment on table public.city_housing is 'Census ACS 5-year housing facts per city page. owner_occupied_pct = B25003 owner-occupied / occupied units; one_unit_detached_pct = B25024 1-unit detached / all housing units; median_year_built = B25035; median_home_value = B25077 (owner-occupied units, dollars).';
comment on column public.city_housing.source_url is 'Human-readable table for the place on data.census.gov (what the page links to).';
comment on column public.city_housing.data_url is 'Census summary file directory the values were read from.';

alter table public.city_housing enable row level security;
grant select on table public.city_housing to anon;
grant select, insert, update, delete on table public.city_housing to service_role;
drop policy if exists "Public reference data is readable" on public.city_housing;
create policy "Public reference data is readable" on public.city_housing for select to anon using (true);

create or replace view public.todo_verify with (security_invoker = true) as
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
  -- export credit has its OWN provenance (0003): source, date, verification and note of the export credit
  select 'utilities[' || u.id || '].avg_export_credit_per_kwh', 'utilities', u.avg_export_credit_per_kwh, u.export_credit_note,
         u.export_credit_source_url, u.export_credit_verified_on, u.export_credit_verification, u.display_order, 2, 3
  from u where u.state = 'CA'
  union all
  select 'cost_ranges[' || c.state || '/' || c.item || '].' || b.k, 'cost_ranges', b.v, null,
         c.source_url, c.verified_on, c.verification,
         1000 + case c.state when 'FL' then 0 else 1 end, case c.item when 'installed_cost_per_watt' then 0 else 1 end, b.n
  from public.cost_ranges c
  cross join lateral (values ('low', c.low, 0), ('likely', c.likely, 1), ('high', c.high, 2)) as b(k, v, n)
  union all
  -- exchange rates (0018): each bound with the row's own provenance
  select 'fx_rates[' || f.id || '].' || b.k, 'fx_rates', b.v, case when b.v is null then f.note end,
         f.source_url, f.verified_on, f.verification, 2000, 0, b.n
  from public.fx_rates f
  cross join lateral (values ('low', f.low, 0), ('likely', f.likely, 1), ('high', f.high, 2)) as b(k, v, n)
  union all
  -- city housing facts (0023): Census ACS 5-year values per city page, each with the row's own provenance
  select 'city_housing[' || h.state || '/' || h.slug || '].' || b.k, 'city_housing', b.v, null,
         h.source_url, h.verified_on, h.verification, 3000 + coalesce(c.display_order, 0), 0, b.n
  from public.city_housing h
  left join public.cities c on c.state = h.state and c.slug = h.slug
  cross join lateral (values ('housing_units', h.housing_units::numeric, 0), ('owner_occupied_pct', h.owner_occupied_pct, 1),
                             ('one_unit_detached_pct', h.one_unit_detached_pct, 2), ('median_year_built', h.median_year_built::numeric, 3),
                             ('median_home_value', h.median_home_value::numeric, 4)) as b(k, v, n)
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


notify pgrst, 'reload schema';
