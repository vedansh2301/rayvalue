-- RayValue /admin/ads: guardrail settings, snapshot cache, alert dedupe, audit log, sourced INR->USD rate, hourly guard.
--
-- APPLY ORDER: after 0017. Purely additive (new tables, their rows, one pg_cron job); safe before or after deploying
-- the code (the page and the cron say "not set up" until these exist).
-- Access: service_role only (the admin page and the cron use SUPABASE_SECRET_KEY); anon / authenticated get nothing.

-- ------------------------------------------------------------ guardrail settings (one row)
-- Thresholds are the owner's product choices, not facts: each row carries a rationale instead of a source.
create table if not exists public.ads_settings (
  id                         boolean primary key default true check (id),
  ad_account_id              text not null check (ad_account_id ~ '^act_[0-9]{5,25}$'),
  leads_spend_no_lead_inr    numeric(12, 2) not null check (leads_spend_no_lead_inr > 0),
  max_cost_per_thruplay_inr  numeric(12, 2) not null check (max_cost_per_thruplay_inr > 0),
  max_daily_budget_inr       numeric(12, 2) not null check (max_daily_budget_inr > 0),
  -- When true the hourly guard pauses an ad set on rule (a) or (b). Off by default; the dashboard has a manual Pause button.
  auto_pause                 boolean not null default false,
  rationale                  text not null check (char_length(rationale) >= 10),
  updated_at                 timestamptz not null default now()
);
comment on table public.ads_settings is 'Guardrails for /admin/ads and /api/cron/ads-guard. Edit here; the code has no thresholds of its own.';

insert into public.ads_settings (id, ad_account_id, leads_spend_no_lead_inr, max_cost_per_thruplay_inr, max_daily_budget_inr, auto_pause, rationale)
values (
  true, 'act_1657520542672231', 400, 9.5, 100, false,
  $r$Owner's cap 2026-10-27: at most ₹100/day across the whole ad account (max_daily_budget_inr). Recommend pausing a leads ad set that has spent ₹400 lifetime (four days at the cap) without a single lead, and a video-views ad set whose cost per ThruPlay is above ₹9.5. auto_pause stays false: pausing is a manual click on /admin/ads until the owner turns it on.$r$
)
on conflict (id) do nothing;

-- ------------------------------------------------------------ snapshot cache
-- Meta's Marketing API is rate limited, so /admin/ads keeps its last snapshot for about 5 minutes. The 'dashboard'
-- snapshot includes Meta Instant Form leads (personal data, same access as public.leads) and is overwritten on refresh.
create table if not exists public.ads_cache (
  key         text primary key check (key ~ '^[a-z0-9_]{1,40}$'),
  fetched_at  timestamptz not null default now(),
  snapshot    jsonb not null check (jsonb_typeof(snapshot) = 'object')
);

-- ------------------------------------------------------------ guard state (alert dedupe)
-- active_keys = the rule keys that were tripped at the last check; an email goes out only for keys not in it.
create table if not exists public.ads_guard_state (
  id             boolean primary key default true check (id),
  active_keys    text[] not null default '{}',
  checked_at     timestamptz null,
  last_email_at  timestamptz null,
  last_outcome   jsonb null
);
insert into public.ads_guard_state (id) values (true) on conflict (id) do nothing;

-- ------------------------------------------------------------ audit log (pauses, alerts)
create table if not exists public.ads_events (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  event   text not null check (char_length(event) between 1 and 60),
  detail  jsonb null
);
create index if not exists ads_events_at_idx on public.ads_events (at desc);

-- ------------------------------------------------------------ sourced exchange rates
-- Facts: a row holding a number must have source_url + verified_on and must not be 'unverified' (same rule as 0002).
create table if not exists public.fx_rates (
  id             text primary key check (id ~ '^[a-z]{3}_per_[a-z]{3}$'),
  low            numeric(14, 6) null check (low is null or low > 0),
  likely         numeric(14, 6) null check (likely is null or likely > 0),
  high           numeric(14, 6) null check (high is null or high > 0),
  unit           text not null check (unit <> ''),
  observed_from  date null,
  observed_to    date null,
  note           text null,
  source_url     text null check (source_url ~ '^https?://'),
  verified_on    date null,
  verification   text not null default 'unverified' check (verification in ('agent_sourced', 'human_verified', 'unverified')),
  updated_at     timestamptz not null default now(),
  constraint fx_rates_numeric_needs_provenance check (
    (low is null and likely is null and high is null)
    or (source_url is not null and verified_on is not null and verification <> 'unverified')
  ),
  constraint fx_rates_order check (low is null or likely is null or high is null or (low <= likely and likely <= high))
);
comment on table public.fx_rates is 'Sourced exchange rates. inr_per_usd = rupees per US dollar, used only to show USD next to INR ad spend on /admin/ads. Refresh weekly from the Federal Reserve H.10 release.';

insert into public.fx_rates (id, low, likely, high, unit, observed_from, observed_to, note, source_url, verified_on, verification)
values (
  'inr_per_usd', 94.46, 94.94, 94.94, 'INR per USD', date '2026-10-19', date '2026-10-23',
  $n$Federal Reserve H.10 weekly release dated October 26, 2026 (rates in currency units per U.S. dollar), INDIA RUPEE: Oct. 19 94.9300, Oct. 20 94.9100, Oct. 21 94.4600, Oct. 22 94.8200, Oct. 23 94.9400. low / high = lowest / highest of the five days, likely = the latest day (Oct. 23). Read on 2026-10-27.$n$,
  'https://www.federalreserve.gov/releases/h10/20261026/', date '2026-10-27', 'agent_sourced'
)
on conflict (id) do nothing;

-- ------------------------------------------------------------ access
do $$
declare t text;
begin
  foreach t in array array['ads_settings', 'ads_cache', 'ads_guard_state', 'ads_events', 'fx_rates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;
grant usage on sequence public.ads_events_id_seq to service_role;

-- ------------------------------------------------------------ hourly guard
-- Same mechanism as 0016 (public.social_cron_call reads the Bearer secret from Vault). The route only emails when a rule
-- newly trips, and never pauses anything while ads_settings.auto_pause is false.
select cron.schedule('ads-guard', '41 * * * *', $$select public.social_cron_call('ads-guard')$$);

notify pgrst, 'reload schema';
