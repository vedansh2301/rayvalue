-- RayValue ads hour schedule: switch one daily-budget ad set on only inside chosen US hours.
--
-- APPLY ORDER: after 0019. Additive (one table, its row, one pg_cron job). Deploy the code first: until
-- /api/cron/ads-schedule exists the job only gets 404s.
-- Access: service_role only, like the 0018 tables.
--
-- Why not Meta's own ad scheduling: it needs a lifetime budget, and on 27 Oct 2026 a lifetime-budget evening ad set
-- spent ₹289.83 in one evening against the owner's ₹100/day cap. A daily budget plus this on/off switch keeps the cap.

create table if not exists public.ads_schedule (
  id          boolean primary key default true check (id),
  adset_id    text not null check (adset_id ~ '^[0-9]{5,25}$'),
  enabled     boolean not null default false,
  timezone    text not null check (timezone <> ''),
  -- {"mon": [[18, 22]], ...}: [start hour, end hour) in `timezone`, whole hours 0-24. A missing day = no hours.
  windows     jsonb not null check (jsonb_typeof(windows) = 'object'),
  rationale   text not null check (char_length(rationale) >= 10),
  updated_at  timestamptz not null default now()
);
comment on table public.ads_schedule is 'Hour schedule for one ad set (/api/cron/ads-schedule). Edit here; set enabled = false to stop it. Pause on /admin/ads also sets enabled = false.';

insert into public.ads_schedule (id, adset_id, enabled, timezone, windows, rationale)
values (
  true, '120246779987350609', true, 'America/New_York',
  '{"mon": [[18, 22]], "tue": [[18, 22]], "wed": [[18, 22]], "thu": [[18, 22]], "fri": [[18, 22]], "sat": [[10, 21]], "sun": [[10, 21]]}'::jsonb,
  $r$Owner asked 2026-10-29 to run the ads only at the best US times. Assumption, not a measurement: Florida homeowners are home and able to fill in a quote form on weekday evenings (6-10 pm Eastern) and weekend daytime (10 am-9 pm Eastern). RayValue's own data (50 impressions on one evening, 27 Oct) is too thin to pick hours; review the hourly breakdown after about a week and move the windows to the cheapest hours with clicks. Ad set 120246779987350609 = the ₹100/day Florida Instant Form ad set. Cap = ads_settings.max_daily_budget_inr, checked per ad account day (IST).$r$
)
on conflict (id) do nothing;

alter table public.ads_schedule enable row level security;
revoke all on table public.ads_schedule from anon, authenticated;
grant select, insert, update, delete on table public.ads_schedule to service_role;

-- Every 15 minutes, offset from social-publish (7,22,37,52) and ads-guard (41).
select cron.schedule('ads-schedule', '2,17,32,47 * * * *', $$select public.social_cron_call('ads-schedule')$$);

notify pgrst, 'reload schema';
