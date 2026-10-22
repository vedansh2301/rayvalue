-- RayValue: installer-quote leads and privacy (data) requests.
-- Written only by the site's API routes (/api/leads, /api/data-requests) with the publishable (anon) key.
-- anon may INSERT the user-supplied columns only; nobody but the project owner (dashboard / service role)
-- can read, change or delete rows. Spec: docs/design/spec-lead-capture.md.

create extension if not exists citext with schema extensions;

-- ------------------------------------------------------------ leads
create table if not exists public.leads (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  first_name         text not null check (char_length(btrim(first_name)) between 1 and 60),
  email              extensions.citext not null
                     check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone              text not null check (phone ~ '^\+1[2-9][0-9]{9}$'),
  zip                text not null check (zip ~ '^[0-9]{5}$'),
  state              text not null check (state in ('FL', 'CA')),
  utility_id         text null references public.utilities (id) on update cascade on delete set null,
  avg_monthly_bill   numeric null check (avg_monthly_bill is null or avg_monthly_bill > 0),
  battery            smallint null check (battery is null or battery between 0 and 2),
  shading            text null check (shading is null or shading in ('none', 'some', 'heavy')),
  homeowner          boolean not null,
  timeline           text not null check (timeline in ('asap', '1_3_months', '3_6_months', 'researching')),
  estimate_snapshot  jsonb null
                     check (estimate_snapshot is null or (jsonb_typeof(estimate_snapshot) = 'object' and pg_column_size(estimate_snapshot) <= 4096)),
  source             text not null check (char_length(source) between 1 and 100),
  page_path          text null check (page_path is null or char_length(page_path) <= 200),
  consent_text       text not null check (char_length(consent_text) between 1 and 2000),
  consent_version    text not null check (char_length(consent_version) between 1 and 40),
  consent_at         timestamptz not null default now(),
  user_agent         text null check (user_agent is null or char_length(user_agent) <= 300),
  status             text not null default 'new' check (status in ('new', 'contacted', 'sold', 'invalid', 'deleted'))
);
create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_status_idx on public.leads (status);

alter table public.leads enable row level security;
revoke all on table public.leads from anon, authenticated;
grant insert (
  first_name, email, phone, zip, state, utility_id, avg_monthly_bill, battery, shading, homeowner, timeline,
  estimate_snapshot, source, page_path, consent_text, consent_version, user_agent
) on table public.leads to anon;
grant select, insert, update, delete on table public.leads to service_role;

drop policy if exists "Anyone can submit a quote request" on public.leads;
create policy "Anyone can submit a quote request"
  on public.leads
  for insert
  to anon
  with check (true);

-- ------------------------------------------------------------ data_requests
create table if not exists public.data_requests (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  email       extensions.citext not null
              check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  request     text not null check (request in ('delete', 'access', 'correct', 'do_not_sell')),
  details     text null check (details is null or char_length(details) <= 1000),
  status      text not null default 'new' check (status in ('new', 'in_progress', 'done', 'rejected'))
);
create index if not exists data_requests_created_at_idx on public.data_requests (created_at desc);

alter table public.data_requests enable row level security;
revoke all on table public.data_requests from anon, authenticated;
grant insert (email, request, details) on table public.data_requests to anon;
grant select, insert, update, delete on table public.data_requests to service_role;

drop policy if exists "Anyone can submit a data request" on public.data_requests;
create policy "Anyone can submit a data request"
  on public.data_requests
  for insert
  to anon
  with check (true);

notify pgrst, 'reload schema';
