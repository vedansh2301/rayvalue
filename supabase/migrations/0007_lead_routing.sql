-- RayValue Phase 4: lead record (attribution, richer statuses), buyers routing fields, lead_deliveries,
-- DB-backed rate limiting, retry/ownership bookkeeping.
--
-- APPLY ORDER: apply AFTER 0006 and BEFORE deploying the Phase 4 code. The new code writes the columns below.
-- Nothing here is applied automatically; the owner runs it (Supabase SQL editor or `supabase db push`).

-- ------------------------------------------------------------ leads: attribution, status, bookkeeping
alter table public.leads
  add column if not exists utm_source    text null check (utm_source   is null or char_length(utm_source)   <= 200),
  add column if not exists utm_medium    text null check (utm_medium   is null or char_length(utm_medium)   <= 200),
  add column if not exists utm_campaign  text null check (utm_campaign is null or char_length(utm_campaign) <= 200),
  add column if not exists utm_term      text null check (utm_term     is null or char_length(utm_term)     <= 200),
  add column if not exists utm_content   text null check (utm_content  is null or char_length(utm_content)  <= 200),
  add column if not exists gclid         text null check (gclid        is null or char_length(gclid)        <= 200),
  add column if not exists fbclid        text null check (fbclid       is null or char_length(fbclid)       <= 200),
  add column if not exists landing_page  text null check (landing_page is null or char_length(landing_page) <= 300),
  add column if not exists referrer      text null check (referrer     is null or char_length(referrer)     <= 300),
  -- Why the lead has its status (e.g. duplicate, do_not_sell, no_eligible_buyer, dedupe_check_failed).
  add column if not exists status_reason text null check (status_reason is null or char_length(status_reason) <= 200),
  add column if not exists duplicate_of  uuid null references public.leads (id) on delete set null,
  add column if not exists routed_at     timestamptz null,
  add column if not exists returned_at   timestamptz null,
  add column if not exists return_reason text null check (return_reason is null or char_length(return_reason) <= 500);

-- Statuses: new, sent, returned, unserviced, nurture, disqualified, duplicate.
-- Existing values map: contacted -> sent, sold -> sent, invalid -> disqualified, deleted -> disqualified.
-- (Before this migration no code wrote contacted/sold/invalid/deleted; they were manual dashboard values.)
alter table public.leads drop constraint if exists leads_status_check;
update public.leads set status = 'sent'         where status in ('contacted', 'sold');
update public.leads set status = 'disqualified' where status in ('invalid', 'deleted');
alter table public.leads add constraint leads_status_check
  check (status in ('new', 'sent', 'returned', 'unserviced', 'nurture', 'disqualified', 'duplicate'));

create index if not exists leads_phone_created_idx on public.leads (phone, created_at desc);
create index if not exists leads_email_created_idx on public.leads (email, created_at desc);

-- ------------------------------------------------------------ buyers: routing and delivery
alter table public.buyers
  add column if not exists accepted_timelines text[] not null default '{asap,1_3_months,3_6_months}'
    check (accepted_timelines <@ array['asap', '1_3_months', '3_6_months', 'researching']::text[]),
  add column if not exists min_bill_bucket text null
    check (min_bill_bucket is null or min_bill_bucket in ('under_100', '100_150', '150_200', '200_300', '300_400', '400_plus')),
  add column if not exists homeowner_only boolean not null default true,
  add column if not exists exclusive boolean not null default false,
  add column if not exists daily_cap integer null check (daily_cap is null or daily_cap > 0),
  -- Price per lead in US dollars. null = not agreed/unknown (never guessed).
  add column if not exists price numeric(10, 2) null check (price is null or price >= 0),
  add column if not exists delivery_method text not null default 'email' check (delivery_method in ('email', 'webhook', 'crm')),
  -- Where to deliver: an email address (email) or an https URL (webhook / crm: a CRM's inbound JSON endpoint).
  add column if not exists delivery_target text null check (delivery_target is null or char_length(delivery_target) <= 500),
  -- Alternative: NAME of an environment variable holding the target (e.g. TEST_BUYER_EMAIL). Wins over delivery_target.
  add column if not exists delivery_target_env text null check (delivery_target_env is null or delivery_target_env ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  -- NAME of the environment variable holding the webhook HMAC secret. The secret itself is never stored in the database.
  add column if not exists webhook_secret_env text null check (webhook_secret_env is null or webhook_secret_env ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  -- Webhook buyers: NAME of an env var holding an email address to fall back to when the webhook keeps failing.
  add column if not exists fallback_email_env text null check (fallback_email_env is null or fallback_email_env ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  -- {"timezone":"America/New_York","days":[1,2,3,4,5],"open":"09:00","close":"17:00"}; null = deliver any time.
  -- Outside these hours a delivery is queued and sent by the retry job when the window opens.
  add column if not exists business_hours jsonb null check (business_hours is null or jsonb_typeof(business_hours) = 'object');

comment on column public.buyers.price is 'USD per lead. null = unknown; never filled with a guess.';
comment on column public.buyers.webhook_secret_env is 'Name of the env var that holds the HMAC-SHA256 signing secret for webhook deliveries. Not the secret.';
comment on column public.buyers.delivery_target_env is 'Name of an env var that holds the delivery email/URL. Overrides delivery_target.';
comment on column public.buyers.exclusive is 'Exclusive buyers receive a lead alone (no other buyer gets it).';

-- One INACTIVE test buyer so the pipeline can be exercised end to end without a real installer. Its delivery email is
-- read from the TEST_BUYER_EMAIL env var. active = false: it is never named in consent text and never receives leads
-- until the owner flips it on in a test environment.
insert into public.buyers (name, legal_name, states, zips, active, delivery_method, delivery_target_env, homeowner_only)
select 'TEST BUYER', 'Test Buyer (not a real installer)', '{FL,CA}', '{}', false, 'email', 'TEST_BUYER_EMAIL', true
where not exists (select 1 from public.buyers where name = 'TEST BUYER');

-- ------------------------------------------------------------ lead_deliveries
create table if not exists public.lead_deliveries (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  lead_id          uuid not null references public.leads (id) on delete cascade,
  buyer_id         uuid not null references public.buyers (id) on delete restrict,
  method           text not null check (method in ('email', 'webhook', 'crm')),
  -- queued: waiting for business hours / retry; delivered; failed: attempts so far all failed (retry job continues until max).
  status           text not null default 'queued' check (status in ('queued', 'delivered', 'failed', 'abandoned')),
  attempts         smallint not null default 0,
  next_attempt_at  timestamptz null,
  last_attempt_at  timestamptz null,
  delivered_at     timestamptz null,
  response_status  integer null,
  response_excerpt text null check (response_excerpt is null or char_length(response_excerpt) <= 500),
  error            text null check (error is null or char_length(error) <= 300),
  used_fallback    boolean not null default false,
  price            numeric(10, 2) null,
  unique (lead_id, buyer_id)
);
create index if not exists lead_deliveries_lead_idx on public.lead_deliveries (lead_id);
create index if not exists lead_deliveries_buyer_day_idx on public.lead_deliveries (buyer_id, created_at desc);
create index if not exists lead_deliveries_retry_idx on public.lead_deliveries (status, next_attempt_at);
alter table public.lead_deliveries enable row level security;
revoke all on table public.lead_deliveries from anon, authenticated;
grant select, insert, update, delete on table public.lead_deliveries to service_role;

-- ------------------------------------------------------------ rate limiting (best effort, no Vercel Pro needed)
-- Fixed windows keyed by a hash of (scope, IP); no raw IPs are stored. Called by the server with the secret key.
create table if not exists public.rate_limits (
  key          text primary key check (char_length(key) <= 128),
  window_start timestamptz not null,
  hits         integer not null
);
alter table public.rate_limits enable row level security;
revoke all on table public.rate_limits from anon, authenticated;
grant select, insert, update, delete on table public.rate_limits to service_role;

-- true = allowed (and counted), false = over the limit. Atomic upsert so parallel requests cannot all slip through.
create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits integer;
begin
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, pg_catalog.now(), 1)
  on conflict (key) do update
    set window_start = case when r.window_start < pg_catalog.now() - make_interval(secs => p_window_seconds) then pg_catalog.now() else r.window_start end,
        hits         = case when r.window_start < pg_catalog.now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end
  returning r.hits into v_hits;
  -- Opportunistic cleanup of stale keys (1% of calls).
  if pg_catalog.random() < 0.01 then
    delete from public.rate_limits where window_start < pg_catalog.now() - interval '1 day';
  end if;
  return v_hits <= p_max;
end;
$$;
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

notify pgrst, 'reload schema';
