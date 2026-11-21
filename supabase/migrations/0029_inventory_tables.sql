-- RayValue global data model, step 5 of 5: the data-inventory tables the US expansion needs
-- (rvplan/03-data-inventory.md §6), generalised with country + region_code, plus todo_verify_global.
-- APPLY ORDER: after 0028. NO ROWS SEEDED: every table is empty until a sourced row is entered.
--
-- Every fact column follows the house pattern: source_url + verified_on + verification
-- ('agent_sourced' | 'human_verified' | 'unverified'); a row holding a number must be sourced.
-- RLS: anon SELECT only (public reference data), service_role full, like 0002.

-- ------------------------------------------------------- incentive programmes (state-level programmes with per-utility rates, e.g. SGIP)

create table public.incentive_programs (
  id                text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  country           text not null references public.markets (code) on update cascade,
  region_code       text,
  name              text not null check (name <> ''),
  administrator     text,
  eligibility_note  text,
  status            text not null default 'unknown' check (status in ('open', 'waitlist', 'closed', 'unknown')),
  status_as_of      date,
  opens_on          date,
  ends_on           date,
  source_url        text check (source_url ~ '^https?://'),
  verified_on       date,
  verification      text not null default 'unverified' check (verification in ('agent_sourced', 'human_verified', 'unverified')),
  updated_at        timestamptz not null default now(),
  foreign key (country, region_code) references public.regions (country, code) on update cascade,
  constraint incentive_programs_verified_needs_source check (verification = 'unverified' or (source_url is not null and verified_on is not null))
);
comment on table public.incentive_programs is 'Programme status and window (the facts a page states: open / waitlist / closed). Money lives in incentive_program_rates; calculator-ready incentives live in incentives (0028).';

create table public.incentive_program_rates (
  id            uuid primary key default gen_random_uuid(),
  program_id    text not null references public.incentive_programs (id) on update cascade on delete cascade,
  utility_id    text references public.utilities (id) on update cascade on delete cascade,
  step          smallint,
  technology    text not null check (technology in ('storage', 'solar')),
  rate          numeric check (rate >= 0),
  unit          text check (unit in ('per_kwh', 'per_kw', 'flat')),  -- money in the market currency
  cap_kwh       numeric check (cap_kwh > 0),
  cap_note      text,
  source_url    text check (source_url ~ '^https?://'),
  verified_on   date,
  verification  text not null default 'unverified' check (verification in ('agent_sourced', 'human_verified', 'unverified')),
  updated_at    timestamptz not null default now(),
  constraint incentive_program_rates_key unique nulls not distinct (program_id, utility_id, technology, step),
  constraint incentive_program_rates_provenance check (
    case when rate is null and cap_kwh is null then verification = 'unverified'
         else source_url is not null and verified_on is not null and verification <> 'unverified' end
  ),
  constraint incentive_program_rates_unit check (rate is null or unit is not null)
);

-- ------------------------------------------------------- export credit prices (hourly avoided-cost style schedules, e.g. CA NEM 3.0 ACC)

create table public.export_credit_prices (
  utility_id              text not null references public.utilities (id) on update cascade on delete cascade,
  vintage_year            smallint not null,
  month                   smallint not null check (month between 1 and 12),
  day_type                text not null check (day_type in ('weekday', 'weekend')),
  hour                    smallint not null check (hour between 0 and 23),
  generation_per_kwh      numeric check (generation_per_kwh >= 0),   -- market currency
  delivery_per_kwh        numeric check (delivery_per_kwh >= 0),
  lock_in_years           smallint check (lock_in_years > 0),
  source_url              text not null check (source_url ~ '^https?://'),
  verified_on             date not null,
  verification            text not null check (verification in ('agent_sourced', 'human_verified')),
  updated_at              timestamptz not null default now(),
  primary key (utility_id, vintage_year, month, day_type, hour)
);

-- ------------------------------------------------------- net metering rules (tariff details beyond the export rate)

create table public.net_metering_rules (
  utility_id                        text primary key references public.utilities (id) on update cascade on delete cascade,
  tariff_sheet                      text,
  annual_excess_payout_basis        text,
  annual_excess_payout_per_kwh      numeric check (annual_excess_payout_per_kwh >= 0),
  payout_month                      smallint check (payout_month between 1 and 12),
  tier1_max_kw                      numeric check (tier1_max_kw > 0),
  tier2_max_kw                      numeric check (tier2_max_kw > 0),
  tier3_max_kw                      numeric check (tier3_max_kw > 0),
  tier_fee_note                     text,
  battery_net_metered               boolean,
  battery_rule_sheet                text,
  source_url                        text check (source_url ~ '^https?://'),
  verified_on                       date,
  verification                      text not null default 'unverified' check (verification in ('agent_sourced', 'human_verified', 'unverified')),
  updated_at                        timestamptz not null default now(),
  constraint net_metering_rules_provenance check (
    case when annual_excess_payout_per_kwh is null and tier1_max_kw is null and tier2_max_kw is null and tier3_max_kw is null
              and battery_net_metered is null and payout_month is null
         then verification = 'unverified'
         else source_url is not null and verified_on is not null and verification <> 'unverified' end
  )
);

-- ------------------------------------------------------- installed price statistics (LBNL TTS and equivalents)

create table public.installed_price_stats (
  country       text not null references public.markets (code) on update cascade,
  region_code   text not null,
  install_year  smallint not null,
  segment       text not null check (segment in ('pv_only', 'pv_storage', 'storage_only')),
  size_bin      text not null check (size_bin in ('all', 'lt5', '5to10', '10to15', 'gt15')),
  p20           numeric check (p20 >= 0),
  median        numeric check (median >= 0),
  p80           numeric check (p80 >= 0),
  n_systems     integer check (n_systems >= 0),
  unit          text not null check (unit <> ''),   -- e.g. 'per_watt_dc'; money in the market currency
  includes_tax  boolean,
  dollar_year   smallint,
  method_note   text not null,
  source_url    text not null check (source_url ~ '^https?://'),
  verified_on   date not null,
  verification  text not null check (verification in ('agent_sourced', 'human_verified')),
  updated_at    timestamptz not null default now(),
  primary key (country, region_code, install_year, segment, size_bin),
  foreign key (country, region_code) references public.regions (country, code) on update cascade,
  constraint installed_price_stats_order check (
    (p20 is null or median is null or p20 <= median) and (median is null or p80 is null or median <= p80)
  )
);

-- ------------------------------------------------------- utility reliability

create table public.utility_reliability (
  utility_id           text not null references public.utilities (id) on update cascade on delete cascade,
  year                 smallint not null,
  saidi_with_med       numeric check (saidi_with_med >= 0),
  saidi_without_med    numeric check (saidi_without_med >= 0),
  saifi_with_med       numeric check (saifi_with_med >= 0),
  saifi_without_med    numeric check (saifi_without_med >= 0),
  caidi_with_med       numeric check (caidi_with_med >= 0),
  customers            integer check (customers >= 0),
  standard             text check (standard in ('IEEE1366', 'other')),
  source_url           text not null check (source_url ~ '^https?://'),
  verified_on          date not null,
  verification         text not null check (verification in ('agent_sourced', 'human_verified')),
  updated_at           timestamptz not null default now(),
  primary key (utility_id, year)
);

create table public.outage_events (
  id                  uuid primary key default gen_random_uuid(),
  country             text not null references public.markets (code) on update cascade,
  region_code         text,
  utility_id          text references public.utilities (id) on update cascade on delete set null,
  event_name          text not null check (event_name <> ''),
  event_start         date,
  peak_customers_out  integer check (peak_customers_out >= 0),
  restoration_days    numeric check (restoration_days >= 0),
  source_url          text not null check (source_url ~ '^https?://'),
  verified_on         date not null,
  verification        text not null check (verification in ('agent_sourced', 'human_verified')),
  updated_at          timestamptz not null default now(),
  foreign key (country, region_code) references public.regions (country, code) on update cascade
);

-- ------------------------------------------------------- legal provisions (statutes and rules pages cite)

create table public.legal_provisions (
  id                  text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  country             text not null references public.markets (code) on update cascade,
  region_code         text,
  citation            text not null check (citation <> ''),
  title               text not null check (title <> ''),
  topic               text not null check (topic in ('sales_tax', 'property_tax', 'hoa_rights', 'net_metering', 'interconnection', 'federal_credit', 'consumer_protection')),
  summary             text not null check (summary <> ''),
  effective_on        date,
  sunset_on           date,
  last_amended_year   smallint,
  source_url          text not null check (source_url ~ '^https?://'),
  verified_on         date not null,
  verification        text not null check (verification in ('agent_sourced', 'human_verified')),
  updated_at          timestamptz not null default now(),
  foreign key (country, region_code) references public.regions (country, code) on update cascade
);

-- ------------------------------------------------------- market statistics

create table public.market_stats (
  country       text not null references public.markets (code) on update cascade,
  geo_type      text not null check (geo_type in ('country', 'region', 'utility')),
  geo_id        text not null,
  metric        text not null check (metric in ('small_scale_solar_mw', 'net_metered_customers', 'net_metered_kw', 'storage_interconnections', 'avg_residential_price', 'battery_attach_rate')),
  period        text not null,
  value         numeric,
  unit          text not null check (unit <> ''),
  dataset       text not null check (dataset <> ''),
  source_url    text not null check (source_url ~ '^https?://'),
  verified_on   date not null,
  verification  text not null check (verification in ('agent_sourced', 'human_verified')),
  updated_at    timestamptz not null default now(),
  primary key (country, geo_type, geo_id, metric, period)
);
comment on table public.market_stats is 'Published statistics (EIA, regulator datasets). A row exists only when sourced; value may be null where the dataset withholds it.';

-- ------------------------------------------------------- triggers, RLS, grants

do $$
declare t text;
begin
  foreach t in array array['incentive_programs', 'incentive_program_rates', 'export_credit_prices', 'net_metering_rules',
                           'installed_price_stats', 'utility_reliability', 'outage_events', 'legal_provisions', 'market_stats']
  loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    execute format('create policy "Public reference data is readable" on public.%I for select to anon using (true)', t);
  end loop;
end;
$$;

-- ------------------------------------------------------- todo_verify_global
-- Null slots in the global tables (the original todo_verify view is not redefined here, so Tracks A/C/D that
-- replace it are not affected). Same columns as todo_verify's null_value rows, plus country.
-- Service role only, like todo_verify.

create view public.todo_verify_global with (security_invoker = true) as
select 'markets[' || m.code || '].vat_rate' as path, 'markets' as table_name, m.code as country, null::text as note,
       m.vat_source_url as source_url, m.vat_verified_on as verified_on, m.vat_verification as verification
from public.markets m
where m.vat_rate is null and m.code <> 'US'
union all
select 'export_policy_rates[' || r.policy_id || '/' || coalesce(r.valid_from::text, 'start') || '].' || b.k, 'export_policy_rates', p.country, null,
       r.source_url, r.verified_on, r.verification
from public.export_policy_rates r
join public.export_policies p on p.id = r.policy_id
cross join lateral (values ('rate_low', r.rate_low), ('rate_likely', r.rate_likely), ('rate_high', r.rate_high)) as b(k, v)
where b.v is null and p.kind in ('net_billing', 'feed_in', 'gross_metering')
  and (b.k = 'rate_likely' or p.country <> 'US')  -- US low/high are filled from missing_range_spread, like cost_ranges
union all
select 'export_policies[' || p.id || ']', 'export_policies', p.country, 'policy kind not yet verified', p.source_url, p.verified_on, p.verification
from public.export_policies p where p.verification = 'unverified'
union all
select 'incentives[' || i.id || '].amount_likely', 'incentives', i.country, null, i.source_url, i.verified_on, i.verification
from public.incentives i where i.amount_likely is null and i.status <> 'closed'
union all
select 'cost_ranges[' || c.country || '/' || c.region_code || '/' || c.item || '].includes_tax', 'cost_ranges', c.country, null,
       c.source_url, c.verified_on, c.verification
from public.cost_ranges c where c.country <> 'US' and c.includes_tax is null;

comment on view public.todo_verify_global is 'Null / unverified slots in the global tables (markets, export policies, incentives, non-US costs). Union this with todo_verify when generating docs/TODO-VERIFY.md.';
revoke all on table public.todo_verify_global from anon, authenticated;
grant select on table public.todo_verify_global to service_role;

notify pgrst, 'reload schema';
