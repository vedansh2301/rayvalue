-- RayValue: plain homeowner wording for notes shown on utility pages, plus the California schedule-proxy note.
-- Only wording changes: no numeric value, source_url, verified_on or verification is touched.
-- Idempotent: each replace() is a no-op once applied; the assumption row is never overwritten.

-- Duke Energy Florida: drop the internal field name from the visible rate note.
update public.utilities
set rate_note = replace(rate_note,
  'Duke''s RS-1 base energy charge is seasonal, so tier_sets has a summer set (March to November) and a winter set (December to February).',
  'Duke''s RS-1 base energy charge changes with the season: one price applies from March to November and a different one from December to February.')
where id = 'duke-fl';

-- SDG&E: say what the missing season dates mean instead of "months are null".
update public.utilities
set tou_note = replace(tou_note,
  'the table does not state the season dates, so months are null.',
  'the table does not give season dates, so we could not confirm which months use which price.')
where id = 'sdge';

-- TECO: its fixed charge is now sourced from the tariff sheet (commit 3bf6fb3), so the old 'fixed charge is null' wording no longer exists.

-- California utility pages: visible note under the rates table. The text is the rationale (a product statement, no figures).
insert into public.model_assumptions (key, state, value, unit, rationale)
values
  ('ca_schedule_proxy_note', 'CA', '{"applies": true}', 'marker',
   'The rate schedule modeled here (E-TOU-C for PG&E, TOU-D 4-9 PM for SCE, TOU-DR1 for SDG&E) is a pre-solar average-rate proxy: it is the plan a typical home is on before adding solar, used to estimate your usage and the value of the power solar replaces. New customers who go solar under net billing (NEM 3.0) must move to a specific time-of-use plan instead: E-ELEC at PG&E, TOU-D-PRIME at SCE or EV-TOU-5 at SDG&E. See the California NEM 3.0 and batteries guide.')
on conflict (key, state) do nothing;
