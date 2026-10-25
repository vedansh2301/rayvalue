-- RayValue Phase 2 (lead capture): buyers, staffed call hours, multi-step lead fields, phone verification state,
-- named-installer consent, estimate-email requests.
--
-- APPLY ORDER: apply this migration BEFORE deploying the Phase 2 code. It removes the public (anon) INSERT on
-- public.leads; from now on only the site's server-side API (SUPABASE_SECRET_KEY, service_role) writes leads.
--
-- ATTORNEY REVIEW REQUIRED: the consent wording below (v_template). The same constants live in
-- src/lib/leads/consent.ts; consent.test.ts fails if they differ.

-- ------------------------------------------------------------ buyers (installers who buy leads)
-- Phase 4 extends this table (routing, caps, delivery). Phase 2 uses it for: "is this ZIP serviced?" and the
-- installer names shown in the consent. A buyer covers a ZIP when it is active and either lists the ZIP, or
-- lists no ZIPs and covers the ZIP's state. Rows are added by the owner in the dashboard; none are seeded.
create table if not exists public.buyers (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  legal_name  text not null check (char_length(btrim(legal_name)) between 1 and 120),
  states      text[] not null default '{}' check (states <@ array['FL', 'CA']::text[]),
  zips        text[] not null default '{}' check (array_to_string(zips, ',') ~ '^([0-9]{5}(,[0-9]{5})*)?$'),
  active      boolean not null default false
);
comment on table public.buyers is 'Installers that buy RayValue leads. legal_name is shown in the lead consent. active=false rows are ignored. zips empty = every ZIP in states.';

alter table public.buyers enable row level security;
revoke all on table public.buyers from anon, authenticated;
grant select, insert, update, delete on table public.buyers to service_role;

-- Names of the (up to 3) active buyers serving a ZIP, in a stable order. The only thing anon can learn about buyers.
create or replace function public.installers_for_zip(p_zip text, p_state text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.legal_name order by s.created_at, s.id), '{}'::text[])
  from (
    select b.legal_name, b.created_at, b.id
    from public.buyers b
    where b.active
      and (p_zip = any (b.zips) or (cardinality(b.zips) = 0 and p_state = any (b.states)))
    order by b.created_at, b.id
    limit 3
  ) s;
$$;
revoke all on function public.installers_for_zip(text, text) from public;
grant execute on function public.installers_for_zip(text, text) to anon, authenticated, service_role;

-- ------------------------------------------------------------ staffed call hours (per state)
-- The "Talk to someone now" link shows only inside these hours. No rows = never shown. The phone number itself is
-- the CALL_NUMBER environment variable, not stored here.
create table if not exists public.staffed_hours (
  state       text primary key check (state in ('FL', 'CA')),
  timezone    text not null check (char_length(timezone) between 3 and 60),
  days        smallint[] not null check (cardinality(days) > 0 and days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  open_time   time not null,
  close_time  time not null,
  active      boolean not null default true,
  check (close_time > open_time)
);
comment on table public.staffed_hours is 'Hours a person answers the RayValue phone, in the state''s own IANA timezone (e.g. America/New_York). days: ISO weekdays, 1 = Monday .. 7 = Sunday. Hours are the owner''s decision; none are seeded.';
alter table public.staffed_hours enable row level security;
revoke all on table public.staffed_hours from anon, authenticated;
grant select on table public.staffed_hours to anon;
grant select, insert, update, delete on table public.staffed_hours to service_role;
drop policy if exists "Public can read active staffed hours" on public.staffed_hours;
create policy "Public can read active staffed hours" on public.staffed_hours for select to anon using (active);

-- ------------------------------------------------------------ leads: new fields
alter table public.leads
  add column if not exists last_name           text null check (last_name is null or char_length(btrim(last_name)) between 1 and 60),
  add column if not exists street_address      text null check (street_address is null or char_length(btrim(street_address)) between 1 and 200),
  add column if not exists bill_bucket         text null check (bill_bucket is null or bill_bucket in ('under_100', '100_150', '150_200', '200_300', '300_400', '400_plus')),
  add column if not exists roof_age            text null check (roof_age is null or roof_age in ('under_10', '10_20', '20_plus', 'unsure')),
  add column if not exists battery_interest    text null check (battery_interest is null or battery_interest in ('yes', 'no', 'unsure')),
  add column if not exists pay_method          text null check (pay_method is null or pay_method in ('cash', 'loan', 'lease_ppa', 'unsure')),
  -- Phone verification (Twilio Verify). Set by the server only, never by the client.
  add column if not exists phone_verified      boolean not null default false,
  add column if not exists verify_sends        smallint not null default 0,
  add column if not exists verify_checks       smallint not null default 0,
  add column if not exists verify_last_sent_at timestamptz null,
  -- Consent evidence.
  add column if not exists consented_installers text[] not null default '{}',
  add column if not exists consent_ip          text null check (consent_ip is null or char_length(consent_ip) <= 64),
  add column if not exists consent_page_url    text null check (consent_page_url is null or char_length(consent_page_url) <= 300),
  add column if not exists trustedform_cert_url text null check (trustedform_cert_url is null or char_length(trustedform_cert_url) <= 300);

comment on column public.leads.consented_installers is 'legal_name of each installer named in the consent text the person saw. Empty for the "installers serving my area" wording (no active buyer for the ZIP).';
comment on column public.leads.phone_verified is 'true only after Twilio Verify approved a code for this lead''s phone (set by the server).';

-- "shade: not sure" and the new routing statuses.
alter table public.leads drop constraint if exists leads_shading_check;
alter table public.leads add constraint leads_shading_check check (shading is null or shading in ('none', 'some', 'heavy', 'unsure'));
alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads add constraint leads_status_check
  check (status in ('new', 'contacted', 'sold', 'invalid', 'deleted', 'unserviced', 'nurture'));

-- Only the server (service_role) writes leads now.
drop policy if exists "Anyone can submit a quote request" on public.leads;
revoke insert on table public.leads from anon;
grant select, insert, update, delete on table public.leads to service_role;

-- ------------------------------------------------------------ consent check
-- The server composes the consent text from the template and the installer list and stores it with the lead.
-- This trigger independently recomputes the expected text and rejects any lead whose stored text differs, so the
-- stored consent is always exactly one of the two approved wordings.
create or replace function public.leads_set_consent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_template      constant text := 'By clicking "Get my free quotes," I agree that RayValue and {{INSTALLER_NAMES}} may contact me about solar at the phone number and email I provided, including by calls and texts made with automated technology or prerecorded messages. Consent is not a condition of purchase. Message and data rates may apply. Reply STOP to opt out. See our Privacy Policy.';
  v_version_named constant text := '2026-10-25.1';
  v_version_area  constant text := '2026-10-25.2';
  v_area_phrase   constant text := 'solar installers serving my area';
  n        int := coalesce(cardinality(new.consented_installers), 0);
  v_names  text;
  v_expect text;
begin
  if new.consent_version = v_version_named then
    if n = 0 then
      raise exception 'consent version % needs at least one installer', new.consent_version using errcode = 'check_violation';
    end if;
    v_names := case
      when n = 1 then new.consented_installers[1]
      when n = 2 then new.consented_installers[1] || ' and ' || new.consented_installers[2]
      else array_to_string(new.consented_installers[1:n - 1], ', ') || ', and ' || new.consented_installers[n]
    end;
  elsif new.consent_version = v_version_area then
    if n <> 0 then
      raise exception 'consent version % names no installers', new.consent_version using errcode = 'check_violation';
    end if;
    v_names := v_area_phrase;
  else
    raise exception 'unknown consent version' using errcode = 'check_violation';
  end if;
  v_expect := replace(v_template, '{{INSTALLER_NAMES}}', v_names);
  if new.consent_text is distinct from v_expect then
    raise exception 'consent text does not match the approved wording' using errcode = 'check_violation';
  end if;
  new.consent_at := pg_catalog.now();
  return new;
end;
$$;
revoke all on function public.leads_set_consent() from public, anon, authenticated;
drop trigger if exists leads_set_consent on public.leads;
create trigger leads_set_consent before insert on public.leads for each row execute function public.leads_set_consent();

-- ------------------------------------------------------------ estimate-email requests (+ nurture enrollment)
-- "Email me this estimate": no phone needed. Also used by renters (who are not stored as leads). Written by the
-- server only (service_role).
create table if not exists public.estimate_requests (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  email             extensions.citext not null check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  state             text null check (state is null or state in ('FL', 'CA')),
  source            text not null check (char_length(source) between 1 and 100),
  estimate_snapshot jsonb null check (estimate_snapshot is null or (jsonb_typeof(estimate_snapshot) = 'object' and pg_column_size(estimate_snapshot) <= 4096)),
  consent_text      text not null check (char_length(consent_text) between 1 and 2000),
  consent_version   text not null check (char_length(consent_version) between 1 and 40),
  consent_at        timestamptz not null default now(),
  consent_ip        text null check (consent_ip is null or char_length(consent_ip) <= 64),
  user_agent        text null check (user_agent is null or char_length(user_agent) <= 300),
  nurture           boolean not null default true,
  email_status      text not null default 'pending' check (email_status in ('pending', 'sent', 'skipped', 'failed')),
  unsubscribed_at   timestamptz null
);
create index if not exists estimate_requests_created_at_idx on public.estimate_requests (created_at desc);
alter table public.estimate_requests enable row level security;
revoke all on table public.estimate_requests from anon, authenticated;
grant select, insert, update, delete on table public.estimate_requests to service_role;

notify pgrst, 'reload schema';
