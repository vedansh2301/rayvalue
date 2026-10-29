-- RayValue daily ads email: 09:05 IST (03:35 UTC), after the US evening window of the hour schedule (0020) ends.
-- APPLY ORDER: after 0020, once /api/cron/ads-digest is deployed. Additive (one pg_cron job).
select cron.schedule('ads-digest', '35 3 * * *', $$select public.social_cron_call('ads-digest')$$);
