-- RayValue: illustrative bills for the utility pages' worked-examples table (Phase 5.1).
-- A model input (product choice), not a fact: the pages label these bills as illustrative.
-- Idempotent: an existing row is never overwritten.
insert into public.model_assumptions (key, state, value, unit, rationale)
values
  ('utility_example_bills', null, '{"value": [150, 250, 350]}', 'USD per month',
   'Illustrative low, middle and high monthly electric bills for the worked-examples table on utility pages (/solar/<state>/<utility>). Product choice to show a spread of bill sizes; these are not facts or averages for any utility, and the pages label them as illustrative.')
on conflict (key, state) do nothing;
