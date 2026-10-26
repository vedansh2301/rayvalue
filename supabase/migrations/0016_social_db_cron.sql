-- RayValue social CMS: run the publisher from the database on a timer.
--
-- APPLY ORDER: after 0015. Nothing here is applied automatically.
-- GitHub Actions schedules never fired for this repo (0 scheduled runs on 2026-10-26), so pg_cron calls the
-- same routes .github/workflows/social-cron.yml calls; that workflow stays as a manual/backup trigger.
-- The bearer secret is read from Vault at call time and never stored here. Create it once (value = CRON_SECRET in Vercel):
--   select vault.create_secret('<CRON_SECRET>', 'social_cron_secret', 'Bearer secret for rayvalue.com/api/cron/social-*');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- GET https://rayvalue.com/api/cron/<route> with the Vault secret. pg_net is async: the reply lands in net._http_response.
create or replace function public.social_cron_call(route text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_get(
    url := 'https://rayvalue.com/api/cron/' || route,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'social_cron_secret')
    ),
    timeout_milliseconds := 90000
  );
$$;
revoke all on function public.social_cron_call(text) from public, anon, authenticated;

-- Same cadence as the workflow: publish every 15 minutes; token refresh + insights once a day.
select cron.schedule('social-publish', '7,22,37,52 * * * *', $$select public.social_cron_call('social-publish')$$);
select cron.schedule('social-token', '17 9 * * *', $$select public.social_cron_call('social-token')$$);
select cron.schedule('social-insights', '27 9 * * *', $$select public.social_cron_call('social-insights')$$);
