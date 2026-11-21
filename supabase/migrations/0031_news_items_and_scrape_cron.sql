-- News items from RSS/Atom sources + the pg_cron schedule that drives /api/cron/scrape-due.
--
-- APPLY ORDER: after 0030. Needs 0016 (social_cron_call + the Vault secret 'social_cron_secret', which holds the same
-- CRON_SECRET the route checks). GitHub Actions schedules are not relied on for this project.

create table if not exists public.news_items (
  id            uuid primary key default gen_random_uuid(),
  country       text not null check (country ~ '^[a-z]{2}$'),
  source_id     uuid not null references public.sources (id) on delete cascade,
  title         text not null,
  url           text not null check (url ~ '^https?://'),
  published_at  timestamptz,
  summary       text,
  topics        text[] not null default '{}',
  relevance     integer not null default 0 check (relevance >= 0),
  language      text,
  created_at    timestamptz not null default now(),
  unique (source_id, url)
);
comment on table public.news_items is 'Feed items from policy/regulator/utility RSS and Atom sources. relevance = number of distinct solar/battery/tariff keywords (English + the pack language) found in title+summary; only items with relevance >= 1 are stored.';
create index if not exists news_items_country_idx on public.news_items (country, published_at desc);
create index if not exists news_items_relevance_idx on public.news_items (relevance desc, published_at desc);

alter table public.news_items enable row level security;
revoke all on table public.news_items from public, anon, authenticated;
grant select, insert, update, delete on table public.news_items to service_role;

-- Every 10 minutes: the route claims up to 6 due sources and stops at ~45 s (Vercel limit 60 s). With cadences of
-- 1-30 days that covers ~2,000 sources comfortably (up to 864 fetches/day).
select cron.schedule('scrape-due', '*/10 * * * *', $$select public.social_cron_call('scrape-due')$$);
