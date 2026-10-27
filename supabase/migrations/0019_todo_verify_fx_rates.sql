-- todo_verify: also list public.fx_rates (0018) so `npm run todo:verify` shows the INR->USD rate under
-- "Null sourced values" when it is empty and under "Agent-sourced" / "Human-verified" once filled.
--
-- APPLY ORDER: after 0018. NOT applied automatically: it replaces the todo_verify view (same columns: the 0003
-- definition plus the fx_rates slots), so it is kept out of the purely additive 0018. Apply in the Supabase SQL editor.

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
