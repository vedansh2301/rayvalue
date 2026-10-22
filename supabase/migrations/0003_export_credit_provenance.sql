-- RayValue: own provenance for the CA average export credit (utilities.avg_export_credit_per_kwh).
-- The export credit comes from a different document than the utility's tariff (CPUC report, not the
-- rate schedule), so it gets its own source_url / verified_on / verification / note, like avg_rate_*.
-- DDL only: values are filled in the Supabase Table Editor (or by an admin via psql).
--
-- Rule (also enforced in code by UtilitySchema): a non-null export credit needs
-- export_credit_source_url + export_credit_verified_on + export_credit_verification <> 'unverified'.
-- The record-level provenance rule (utilities_numeric_needs_provenance) no longer covers the export
-- credit; it keeps covering the fixed charge, minimum bill and baseline credit.

alter table public.utilities
  add column if not exists export_credit_source_url   text check (export_credit_source_url ~ '^https?://'),
  add column if not exists export_credit_verified_on  date,
  add column if not exists export_credit_note         text,
  add column if not exists export_credit_verification text not null default 'unverified'
    check (export_credit_verification in ('agent_sourced', 'human_verified', 'unverified'));

comment on column public.utilities.export_credit_source_url is 'Source of avg_export_credit_per_kwh (its own provenance, not the tariff source_url).';
comment on column public.utilities.export_credit_verified_on is 'Date the export credit source was read.';
comment on column public.utilities.export_credit_note is 'What the export credit figure is (e.g. statewide all-hours average) and its caveats.';
comment on column public.utilities.export_credit_verification is 'agent_sourced | human_verified | unverified, for avg_export_credit_per_kwh only.';
comment on column public.utilities.avg_export_credit_per_kwh is 'CA only: USD per kWh exported under net billing. null = unknown. Own provenance in export_credit_*.';

alter table public.utilities drop constraint if exists utilities_numeric_needs_provenance;
alter table public.utilities add constraint utilities_numeric_needs_provenance check (
  (fixed_monthly_charge is null and minimum_monthly_bill is null and baseline_credit_per_kwh is null)
  or (source_url is not null and verified_on is not null and verification <> 'unverified')
);

alter table public.utilities drop constraint if exists utilities_export_credit_needs_provenance;
alter table public.utilities add constraint utilities_export_credit_needs_provenance check (
  avg_export_credit_per_kwh is null
  or (export_credit_source_url is not null and export_credit_verified_on is not null and export_credit_verification <> 'unverified')
);

-- todo_verify: same as 0002 except the export credit slot now uses the export_credit_* provenance.
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
