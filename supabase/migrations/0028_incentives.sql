-- RayValue global data model, step 4 of 5: date-effective incentives.
-- APPLY ORDER: after 0027.
--
-- One row per incentive programme/offer. NO ROWS ARE SEEDED. In particular the US federal residential clean
-- energy credit (Section 25D) has no row, which is how CLAUDE.md rule 2 stays true ("show only incentives that
-- have a sourced, date-valid row"). The Zod schema in code additionally rejects any US-wide tax_credit row that
-- is still effective on or after 2026-01-01.
--
-- amount_type (calculator: src/lib/calc/incentives.ts), all money in the market currency:
--   per_kw          amount x installed kW             (Ontario HRS, Quebec, India central subsidy tier)
--   per_kwh_storage amount x usable battery kWh       (Ontario battery rebate)
--   flat            fixed amount per system
--   percent         share (0-1) of the installed cost
--   annual_payment  paid every year (VPP programmes); not an upfront deduction
-- amount_low/likely/high is a range (e.g. a market-set certificate price). Caps: cap_amount (absolute),
-- cap_percent_of_cost (0-1), max_kw / max_kwh (eligible size).

create table public.incentives (
  id                      text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  country                 text not null references public.markets (code) on update cascade,
  region_code             text,
  name                    text not null check (name <> ''),
  administrator           text,
  applies_to              text not null check (applies_to in ('solar', 'battery', 'both')),
  incentive_type          text not null check (incentive_type in ('rebate', 'tax_credit', 'upfront_discount', 'annual_payment')),
  amount_type             text not null check (amount_type in ('per_kw', 'per_kwh_storage', 'flat', 'percent', 'annual_payment')),
  amount_low              numeric check (amount_low >= 0),
  amount_likely           numeric check (amount_likely >= 0),
  amount_high             numeric check (amount_high >= 0),
  cap_amount              numeric check (cap_amount >= 0),
  cap_percent_of_cost     numeric check (cap_percent_of_cost between 0 and 1),
  max_kw                  numeric check (max_kw > 0),
  max_kwh                 numeric check (max_kwh > 0),
  -- Is the incentive itself taxable income? null = unknown.
  taxable                 boolean,
  -- Taking this incentive rules out an export policy kind (Ontario HRS excludes net_metering). null = stackable.
  excludes_export_kind    text check (excludes_export_kind in ('net_metering', 'net_billing', 'feed_in', 'gross_metering', 'none', 'br_fio_b')),
  status                  text not null default 'unknown' check (status in ('open', 'waitlist', 'closed', 'unknown')),
  status_as_of            date,
  effective_from          date,
  effective_to            date,
  eligibility_note        text,
  note                    text,
  source_url              text check (source_url ~ '^https?://'),
  verified_on             date,
  verification            text not null default 'unverified' check (verification in ('agent_sourced', 'human_verified', 'unverified')),
  updated_at              timestamptz not null default now(),
  foreign key (country, region_code) references public.regions (country, code) on update cascade,
  constraint incentives_dates check (effective_to is null or effective_from is null or effective_to >= effective_from),
  constraint incentives_order check (
    (amount_low is null or amount_likely is null or amount_low <= amount_likely)
    and (amount_likely is null or amount_high is null or amount_likely <= amount_high)
    and (amount_low is null or amount_high is null or amount_low <= amount_high)
  ),
  constraint incentives_storage_applies check (amount_type <> 'per_kwh_storage' or applies_to in ('battery', 'both')),
  constraint incentives_provenance check (
    case when amount_low is null and amount_likely is null and amount_high is null
              and cap_amount is null and cap_percent_of_cost is null and max_kw is null and max_kwh is null
      then verification = 'unverified'
      else source_url is not null and verified_on is not null and verification <> 'unverified'
    end
  )
);
comment on table public.incentives is 'Date-effective incentives. The calculator uses only rows whose effective window contains the install date AND that hold a likely amount; no row = no incentive (US federal 25D has none for 2026+ installs).';
comment on column public.incentives.effective_from is 'First install date the incentive applies to; null = unknown start (treated as already in force).';
comment on column public.incentives.effective_to is 'Last install date; null = open-ended.';
comment on column public.incentives.excludes_export_kind is 'Export policy kind this incentive cannot be combined with; the engine drops the incentive (or the export credit) per path.';
create index incentives_scope_idx on public.incentives (country, region_code);

create trigger set_updated_at before update on public.incentives for each row execute function public.set_updated_at();

alter table public.incentives enable row level security;
revoke all on table public.incentives from anon, authenticated;
grant select on table public.incentives to anon;
grant select, insert, update, delete on table public.incentives to service_role;
create policy "Public reference data is readable" on public.incentives for select to anon using (true);

notify pgrst, 'reload schema';
