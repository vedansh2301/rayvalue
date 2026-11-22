-- RayValue: global email subscribers (US, UK, Germany, Australia): "email me my payback report" and deadline alerts.
--
-- One row per (email, country). Written ONLY by the server (src/lib/server/global-subscribe.ts) with the secret
-- (service_role) key: anon and authenticated have no access at all, so there are no public reads or writes and no
-- policies. Double opt-in: a row is created unconfirmed, the confirmation email carries a one-time confirm_token, and
-- confirmed_at is set only when the person confirms (src/pages/subscribe/confirm.astro). unsubscribe_token is a
-- random value used by the unsubscribe link (and RFC 8058 one-click). The older FL/CA tables (rate_alert_subscribers,
-- estimate_requests) are untouched and keep working.
--
-- APPLY ORDER: after 0038. The new code degrades safely until it is applied: the endpoint answers 503 for the new
-- countries (the table is missing) and the legacy FL/CA path is unaffected. Touches no table the US/GB/DE/AU
-- calculator loaders read (no cost_ranges / model_assumptions / utilities / markets rows), so nothing in the sitemap
-- or the utility pages can change; still curl /sitemap.xml and a US utility page after applying.

create table if not exists public.email_subscribers (
  id                uuid primary key default gen_random_uuid(),
  email             extensions.citext not null
                    check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  country           text not null check (country in ('US', 'GB', 'DE', 'AU')),
  -- US state code, UK price-cap region id, German Bundesland id or Australian network id (as the calculator uses them).
  region            text null check (region is null or char_length(region) between 1 and 64),
  topics            text[] not null check (cardinality(topics) >= 1 and topics <@ array['report', 'deadline_alerts']::text[]),
  locale            text not null default 'en' check (locale in ('en', 'de')),
  source            text null check (source is null or char_length(source) <= 80),
  consent_text      text not null check (char_length(consent_text) between 1 and 1000),
  consent_version   text not null check (char_length(consent_version) between 1 and 40),
  consent_at        timestamptz not null default now(),
  -- The calculator answers behind "my payback report": a small allow-listed set of query parameters, never numbers computed by the client.
  report_params     jsonb null,
  confirm_token     text not null check (char_length(confirm_token) between 32 and 128),
  unsubscribe_token text not null check (char_length(unsubscribe_token) between 32 and 128),
  -- Topics asked for again by an already-confirmed address: they join `topics` only when the person confirms by email.
  pending_topics    text[] null check (pending_topics is null or pending_topics <@ array['report', 'deadline_alerts']::text[]),
  -- When we last emailed this address (limits how often one address can be emailed; confirmation links expire 7 days after it).
  last_email_at     timestamptz null,
  confirmed_at      timestamptz null,
  unsubscribed_at   timestamptz null,
  created_at        timestamptz not null default now(),
  unique (email, country),
  unique (confirm_token),
  unique (unsubscribe_token)
);

comment on table public.email_subscribers is 'Global email list (US/GB/DE/AU): payback-report emails and deadline-alert opt-ins. Double opt-in; server-only (service_role). Deadline-alert SENDING is not built yet: rows with topics @> {deadline_alerts}, confirmed_at not null and unsubscribed_at null are the audience.';
comment on column public.email_subscribers.report_params is 'Allow-listed calculator query parameters (region, bill, battery...) used to build the reopen-my-estimate link. No computed figures.';

create index if not exists email_subscribers_audience_idx on public.email_subscribers (country) where confirmed_at is not null and unsubscribed_at is null;

alter table public.email_subscribers enable row level security;
revoke all on table public.email_subscribers from anon, authenticated;
grant select, insert, update, delete on table public.email_subscribers to service_role;

notify pgrst, 'reload schema';
