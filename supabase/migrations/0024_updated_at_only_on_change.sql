-- updated_at moves only on a real change. The 0002 triggers fire on every UPDATE, so re-running a fill migration
-- (same values) bumped updated_at and therefore the sitemap <lastmod> with no content change. Each trigger is
-- recreated with WHEN (old is distinct from new). city_housing (0023) had no updated_at trigger at all; it gets one.
-- No data is written. APPLY ORDER: after 0023.

drop trigger if exists set_updated_at on public.utilities;
create trigger set_updated_at before update on public.utilities
  for each row when (old is distinct from new) execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.utility_tier_sets;
create trigger set_updated_at before update on public.utility_tier_sets
  for each row when (old is distinct from new) execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.utility_tiers;
create trigger set_updated_at before update on public.utility_tiers
  for each row when (old is distinct from new) execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.utility_tou_rates;
create trigger set_updated_at before update on public.utility_tou_rates
  for each row when (old is distinct from new) execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.cost_ranges;
create trigger set_updated_at before update on public.cost_ranges
  for each row when (old is distinct from new) execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.model_assumptions;
create trigger set_updated_at before update on public.model_assumptions
  for each row when (old is distinct from new) execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.cities;
create trigger set_updated_at before update on public.cities
  for each row when (old is distinct from new) execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.pvwatts_city_production;
create trigger set_updated_at before update on public.pvwatts_city_production
  for each row when (old is distinct from new) execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.offers;
create trigger set_updated_at before update on public.offers
  for each row when (old is distinct from new) execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.city_housing;
create trigger set_updated_at before update on public.city_housing
  for each row when (old is distinct from new) execute function public.set_updated_at();
