-- RayValue: "Rate change alerts" email signups.
-- Written only by the Cloudflare Pages Function functions/api/subscribe.ts using the
-- publishable (anon) key. Anon may INSERT only; nobody but the dashboard/service role can read.

create extension if not exists citext with schema extensions;

create table if not exists public.rate_alert_subscribers (
  id          uuid primary key default gen_random_uuid(),
  email       extensions.citext not null unique
              check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  state       text not null check (state in ('FL', 'CA')),
  source      text check (source is null or char_length(source) <= 64),
  created_at  timestamptz not null default now()
);

alter table public.rate_alert_subscribers enable row level security;

revoke all on table public.rate_alert_subscribers from anon, authenticated;
grant insert (email, state, source) on table public.rate_alert_subscribers to anon;

drop policy if exists "Anyone can subscribe to rate alerts" on public.rate_alert_subscribers;
create policy "Anyone can subscribe to rate alerts"
  on public.rate_alert_subscribers
  for insert
  to anon
  with check (state in ('FL', 'CA'));
