-- RayValue global data model, step 3 of 5: export policies (how a market pays for solar exported to the grid).
-- APPLY ORDER: after 0026 (needs markets/regions and utilities.country).
--
-- export_policies  one row per policy: kind + scope (country, optional region) + how the year-end true-up works.
-- export_policy_rates  date-effective rate rows (valid_from / valid_to), each a low / likely / high range with its
--                  own provenance. A feed-in step schedule is several rows (years_from / years_to); a Brazilian
--                  Fio B schedule is one row per calendar-year window carrying the non-offset share.
--
-- kind values (calculator: src/lib/calc/export-policy.ts):
--   net_metering   exports bank kWh at retail (FL today). Tiered or flat retail rates.
--   net_billing    self-consumed kWh at retail + exported kWh at the export rate (CA NEM 3.0, BC, PK, SA).
--   feed_in        like net_billing, optional daily cap and year-stepped rate (AU, NZ, JP FIT).
--   gross_metering all production sold at the buy-back rate, all use bought at retail.
--   none           exports are worth 0 (self-consumption only).
--   br_fio_b       kWh netting where a date-effective share of the Fio B component is not offset (Brazil Lei 14.300).
--
-- Backfill (no invented values): the legacy utilities.metering_type maps to a policy, and the CA average export
-- credit is COPIED with its own provenance from utilities (0003). utilities.avg_export_credit_per_kwh remains the
-- value the US calculator reads until it switches; after the switch edit export_policy_rates, not utilities.

create table public.export_policies (
  id            text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  country       text not null references public.markets (code) on update cascade,
  region_code   text,
  name          text not null check (name <> ''),
  kind          text not null check (kind in ('net_metering', 'net_billing', 'feed_in', 'gross_metering', 'none', 'br_fio_b')),
  -- What happens to kWh still banked at the end of the true-up period (net_metering only).
  true_up       text check (true_up in ('forfeit', 'pay_at_rate', 'carry')),
  note          text,
  source_url    text check (source_url ~ '^https?://'),
  verified_on   date,
  verification  text not null default 'unverified' check (verification in ('agent_sourced', 'human_verified', 'unverified')),
  updated_at    timestamptz not null default now(),
  foreign key (country, region_code) references public.regions (country, code) on update cascade,
  constraint export_policies_verified_needs_source check (verification = 'unverified' or (source_url is not null and verified_on is not null)),
  constraint export_policies_true_up_net_metering check (true_up is null or kind = 'net_metering')
);
comment on table public.export_policies is 'How exports are paid, per country/region (kind) with date-effective rates in export_policy_rates. verification describes the policy KIND; numbers live (with their own provenance) in the rates table.';
comment on column public.export_policies.true_up is 'net_metering only: forfeit = leftover kWh at year end are worth 0 (what the US calculator assumes today); pay_at_rate = paid at the policy rate; carry = rolled over.';

create table public.export_policy_rates (
  id                      uuid primary key default gen_random_uuid(),
  policy_id               text not null references public.export_policies (id) on update cascade on delete cascade,
  -- Date-effective window. null valid_from = in force since before the data starts (unknown); null valid_to = open-ended.
  valid_from              date,
  valid_to                date,
  -- Year-of-system window for step schedules (feed-in years 1-4 then 5+). Defaults to every year.
  years_from              smallint not null default 1 check (years_from >= 1),
  years_to                smallint check (years_to >= 1),
  -- Money per kWh in the market currency (markets.currency). Low / likely / high.
  rate_low                numeric check (rate_low >= 0),
  rate_likely             numeric check (rate_likely >= 0),
  rate_high               numeric check (rate_high >= 0),
  daily_cap_kwh           numeric check (daily_cap_kwh > 0),
  -- br_fio_b: Fio B component in currency per kWh, and the share of it NOT offset in this window (0-1).
  fio_b_per_kwh           numeric check (fio_b_per_kwh >= 0),
  fio_b_non_offset_share  numeric check (fio_b_non_offset_share between 0 and 1),
  note                    text,
  source_url              text check (source_url ~ '^https?://'),
  verified_on             date,
  verification            text not null default 'unverified' check (verification in ('agent_sourced', 'human_verified', 'unverified')),
  updated_at              timestamptz not null default now(),
  constraint export_policy_rates_dates check (valid_to is null or valid_from is null or valid_to >= valid_from),
  constraint export_policy_rates_years check (years_to is null or years_to >= years_from),
  constraint export_policy_rates_order check (
    (rate_low is null or rate_likely is null or rate_low <= rate_likely)
    and (rate_likely is null or rate_high is null or rate_likely <= rate_high)
    and (rate_low is null or rate_high is null or rate_low <= rate_high)
  ),
  constraint export_policy_rates_provenance check (
    case when rate_low is null and rate_likely is null and rate_high is null and daily_cap_kwh is null
              and fio_b_per_kwh is null and fio_b_non_offset_share is null
      then verification = 'unverified'
      else source_url is not null and verified_on is not null and verification <> 'unverified'
    end
  )
);
comment on table public.export_policy_rates is 'Date-effective, sourced export rates (low / likely / high) for an export policy. A policy with no rate rows (net_metering, none) needs none. Unknown values stay null and are listed in todo_verify_global.';
create index export_policy_rates_policy_idx on public.export_policy_rates (policy_id, valid_from);

alter table public.utilities add column export_policy_id text references public.export_policies (id) on update cascade on delete set null;
comment on column public.utilities.export_policy_id is 'Export policy that applies to this plan (replaces metering_type once the calculator switches).';

create trigger set_updated_at before update on public.export_policies for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.export_policy_rates for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ backfill

-- FL: one retail net metering policy for the state. Kind is unverified until the owner signs it off
-- (the legacy metering_type column carried no provenance).
insert into public.export_policies (id, country, region_code, name, kind, true_up, note)
select 'us-fl-net-metering', 'US', 'FL', 'Florida retail net metering', 'net_metering', 'forfeit',
       'Backfilled from utilities.metering_type = retail_net_metering. true_up forfeit mirrors the calculator today: kWh still banked after December are valued at $0 (conservative).'
where exists (select 1 from public.utilities where metering_type = 'retail_net_metering');

-- CA: one net billing policy per utility, carrying the utility's export credit and its own provenance (0003).
insert into public.export_policies (id, country, region_code, name, kind, note)
select 'us-ca-' || u.id || '-net-billing', 'US', 'CA', u.name || ' net billing (NEM 3.0)', 'net_billing',
       'Backfilled from utilities.metering_type = nem3_net_billing.'
from public.utilities u where u.metering_type = 'nem3_net_billing';

insert into public.export_policy_rates (policy_id, rate_likely, note, source_url, verified_on, verification)
select 'us-ca-' || u.id || '-net-billing', u.avg_export_credit_per_kwh, u.export_credit_note,
       case when u.avg_export_credit_per_kwh is null then null else u.export_credit_source_url end,
       case when u.avg_export_credit_per_kwh is null then null else u.export_credit_verified_on end,
       case when u.avg_export_credit_per_kwh is null then 'unverified' else u.export_credit_verification end
from public.utilities u where u.metering_type = 'nem3_net_billing';

update public.utilities set export_policy_id = 'us-fl-net-metering' where metering_type = 'retail_net_metering';
update public.utilities set export_policy_id = 'us-ca-' || id || '-net-billing' where metering_type = 'nem3_net_billing';

-- ------------------------------------------------------------------ RLS + grants

do $$
declare t text;
begin
  foreach t in array array['export_policies', 'export_policy_rates']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    execute format('create policy "Public reference data is readable" on public.%I for select to anon using (true)', t);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
