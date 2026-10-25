-- RayValue Phase 6: nurture email bookkeeping + suppression list, and owner-entered weekly KPI inputs.
--
-- APPLY ORDER: after 0009. Safe to apply before or after deploying the Phase 6 code (the nurture job and
-- /admin/kpi simply report "not set up" until it exists). Nothing here is applied automatically.

-- ------------------------------------------------------------ nurture bookkeeping
-- nurture_step = how many nurture emails have been sent (0-5). The estimate email counts as step 1 once it is
-- sent (estimate_requests.email_status = 'sent'), so the job only advances from there.
alter table public.estimate_requests
  add column if not exists nurture_step smallint not null default 0 check (nurture_step between 0 and 5),
  add column if not exists nurture_last_sent_at timestamptz null;
alter table public.leads
  add column if not exists nurture_step smallint not null default 0 check (nurture_step between 0 and 5),
  add column if not exists nurture_last_sent_at timestamptz null;

-- ------------------------------------------------------------ suppression list
-- Anyone who clicks an unsubscribe link lands here; the nurture job never emails an address in this table, whichever
-- table the address came from. Written by the server with the secret key only.
create table if not exists public.email_suppressions (
  email      extensions.citext primary key check (char_length(email) <= 254),
  created_at timestamptz not null default now(),
  reason     text not null default 'unsubscribe' check (char_length(reason) between 1 and 60)
);
alter table public.email_suppressions enable row level security;
revoke all on table public.email_suppressions from anon, authenticated;
grant select, insert, update, delete on table public.email_suppressions to service_role;

-- ------------------------------------------------------------ owner-entered weekly inputs (/admin/kpi)
-- One row per week (the Monday, UTC) and traffic source ('' = all sources together). Every number is NULL until you
-- type it in. ad_spend and the web-funnel counts (read them off the Vercel Analytics dashboard) are not in the
-- database otherwise; /admin/kpi never estimates a missing value.
-- For a given week enter EITHER one row with source '' (all sources) OR one row per source, not both: every row is added
-- to that week's totals.
create table if not exists public.kpi_weekly_inputs (
  id                 uuid primary key default gen_random_uuid(),
  week_start         date not null,
  source             text not null default '' check (char_length(source) <= 100),
  ad_spend           numeric(12, 2) null check (ad_spend is null or ad_spend >= 0),
  calc_starts        integer null check (calc_starts is null or calc_starts >= 0),
  calc_completes     integer null check (calc_completes is null or calc_completes >= 0),
  results_cta_clicks integer null check (results_cta_clicks is null or results_cta_clicks >= 0),
  quote_form_starts  integer null check (quote_form_starts is null or quote_form_starts >= 0),
  notes              text null check (notes is null or char_length(notes) <= 500),
  unique (week_start, source)
);
comment on column public.kpi_weekly_inputs.week_start is 'Monday of the week (UTC), e.g. 2026-11-02.';
comment on column public.kpi_weekly_inputs.source is 'Match the lead source shown on /admin/kpi (utm_source, else lead source); empty = all sources.';
alter table public.kpi_weekly_inputs enable row level security;
revoke all on table public.kpi_weekly_inputs from anon, authenticated;
grant select, insert, update, delete on table public.kpi_weekly_inputs to service_role;

notify pgrst, 'reload schema';
