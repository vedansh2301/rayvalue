-- RayValue ads hour schedule: switch off below the ₹100/day cap, and check every 5 minutes.
--
-- APPLY ORDER: after 0020. Safe before or after the code (older code ignores the column; newer code without it uses
-- the cap).
--
-- Why: on the first scheduled night (29 Oct 2026 US evening = 30 Oct IST) the schedule paused the ad set when Meta
-- reported ₹105.94 for the day, but the day closed at ₹126.41: ₹20.47 more arrived after the pause because Meta reports
-- spend late, and up to 15 minutes passed between checks. Stopping at ₹75 leaves about that much room under ₹100.

alter table public.ads_schedule
  add column if not exists stop_at_inr numeric(12, 2) null check (stop_at_inr is null or stop_at_inr > 0);
comment on column public.ads_schedule.stop_at_inr is 'Switch the ad set off once today''s whole-account spend reaches this (used only when below ads_settings.max_daily_budget_inr).';

update public.ads_schedule
set stop_at_inr = 75,
    rationale = rationale || $r$ 2026-10-30: stop_at_inr = ₹75 because night 1 overshot: paused at a reported ₹105.94, the day closed at ₹126.41 (₹20.47 reported late). Lower it further if a day still closes above ₹100.$r$,
    updated_at = now()
where id;

-- Same job name, so this replaces the 15-minute schedule from 0020.
select cron.schedule('ads-schedule', '*/5 * * * *', $$select public.social_cron_call('ads-schedule')$$);

notify pgrst, 'reload schema';
