-- RayValue: lease / PPA comparison inputs (Phase 3.4).
--
-- Adds four assumption rows for the lease/PPA comparison on calculator results. Every bound is NULL:
-- no primary source for typical lease or PPA pricing has been verified, so nothing is invented. While a row's
-- bounds are null the site shows plain-language explanation only and no lease/PPA numbers.
-- To switch the comparison on, set low/likely/high on ALL FOUR rows in the Table Editor (low <= likely <= high)
-- and put where the figures came from in `rationale`. Units:
--   lease_monthly_per_kw    USD per kW of system size per month, year 1
--   lease_annual_escalator  share per year (0.02 = 2%)
--   ppa_rate_per_kwh        USD per kWh produced, year 1
--   ppa_annual_escalator    share per year (0.02 = 2%)
-- Idempotent: existing rows are never overwritten.

insert into public.model_assumptions (key, state, value, unit, rationale)
values
  ('lease_monthly_per_kw', null, '{"low": null, "likely": null, "high": null}', 'USD per kW of system per month (year 1)',
   'Left empty on purpose: lease pricing varies by installer, state and contract and no primary source has been verified yet. Enter a sourced range here (and name the source in this text) to show the lease comparison.'),
  ('lease_annual_escalator', null, '{"low": null, "likely": null, "high": null}', 'share per year (0.02 = 2%)',
   'Left empty on purpose: contract escalators vary (including none) and no primary source has been verified yet. Enter a sourced range here (and name the source in this text) to show the lease comparison.'),
  ('ppa_rate_per_kwh', null, '{"low": null, "likely": null, "high": null}', 'USD per kWh produced (year 1)',
   'Left empty on purpose: PPA prices vary by installer, utility territory and contract and no primary source has been verified yet. Enter a sourced range here (and name the source in this text) to show the PPA comparison.'),
  ('ppa_annual_escalator', null, '{"low": null, "likely": null, "high": null}', 'share per year (0.02 = 2%)',
   'Left empty on purpose: contract escalators vary (including none) and no primary source has been verified yet. Enter a sourced range here (and name the source in this text) to show the PPA comparison.')
on conflict (key, state) do nothing;
