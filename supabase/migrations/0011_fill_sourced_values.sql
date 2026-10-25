-- Fill / refresh sourced values found on primary sources on 2026-10-25. Data-only UPDATEs, idempotent
-- (re-running sets the same values). verification stays 'agent_sourced'; only the owner sets 'human_verified'.
-- Arithmetic used (all explained in the row notes): per-day charge x 365 / 12 for the monthly fixed charge.

-- ---------------------------------------------------------------- TECO (Tampa Electric)
update public.utilities set
  fixed_monthly_charge = 13.69,
  fixed_charge_note = $n$Tariff Sheet No. 6.030 (Residential Service, schedule RS, date effective January 1, 2026) prints 'Basic Service Charge: $ 0.45 per day.' Monthly figure = 0.45 x 365 / 12 = 13.6875, rounded to $13.69. The January 2026 customer rate insert prints the same charge as '0.45 cents per day', which is a unit typo; the tariff sheet is the controlling document.$n$,
  minimum_monthly_bill = null,
  minimum_bill_basis = 'none',
  minimum_bill_note = $n$Tariff Sheet No. 6.030 (RS) prints 'MINIMUM CHARGE: The Basic Service Charge.' So the only minimum is the daily basic service charge, which is already in fixed_monthly_charge; there is no separate minimum bill amount.$n$,
  rate_note = $n$All-in rate = energy charge + fuel charge + storm protection charge + clean energy transition mechanism. Read on 2026-10-25 from Tampa Electric's current Tariff Section 6: Sheet 6.030 (RS energy and demand charge 8.948 / 9.948 cents/kWh up to / over 1,000 kWh, effective January 1, 2026), Sheet 6.020 (fuel 3.210 / 4.210; capacity 0.264; environmental 0.087; recovery period January through December 2026), Sheet 6.021 (energy conservation 0.270; storm protection plan 0.717) and Sheet 6.025 (clean energy transition 0.406). The energy charge printed in the January 2026 insert (9.569 / 10.569) equals sheet 6.030 energy 8.948 / 9.948 plus conservation + capacity + environmental (0.270 + 0.264 + 0.087 = 0.621). All-in = 9.569 + 3.210 + 0.717 + 0.406 = 13.902 and 10.569 + 4.210 + 0.717 + 0.406 = 15.902 cents/kWh. The posted fuel factors cover all of 2026, so no fuel change since January 2026 was found. Storm Surcharge Sheet 6.024 (date effective August 1, 2026) now shows no charge, so the surcharge has ended and is excluded. Taxes and franchise fees are not included.$n$,
  source_url = 'https://www.tampaelectric.com/48ce35/siteassets/files/tariff/tariffsection6.pdf',
  verified_on = date '2026-10-25',
  verification = 'agent_sourced',
  source_caveat = null
where id = 'teco';

-- ---------------------------------------------------------------- California average rates
-- low / high = lowest and highest residential average rate (excluding the California Climate Credit)
-- among the Public Advocates Office (CPUC) Electric Rates Report snapshots: June 2025 (Q2 2025 report),
-- October 2025 (Q3 2025), January 2026 (Q4 2025), March 2026 (Q1 2026), June 2026 (Q2 2026).
-- This is the observed range over about 12 months, not a forecast.
update public.utilities set
  avg_rate_low = 0.337,
  avg_rate_high = 0.386,
  avg_rate_note = $n$Likely = published residential average rate for PG&E as of June 2026 in the Public Advocates Office (CPUC) Q2 2026 Electric Rates Report (PG&E's rates have not changed since March 2026). Low / high = lowest and highest of the five residential average rates (excluding the California Climate Credit) printed in the Public Advocates Office reports for June 2025, October 2025, January 2026, March 2026 and June 2026: $0.386, $0.378, $0.350, $0.337, $0.337 per kWh. So the range is what PG&E's published average actually was over the past year (it fell), not a forecast. Reports: Q2 2025 https://publicadvocatesa.cpuc.ca.gov/-/media/cal-advocates-website/files/press-room/reports-and-analyses/250827-public-advocates-office-q2-2025-rates-report.pdf ; Q3 2025 https://www.publicadvocates.cpuc.ca.gov/-/media/cal-advocates-website/files/press-room/reports-and-analyses/251106-public-advocates-office-q3-2025-rates-report.pdf ; Q4 2025 https://www.publicadvocates.cpuc.ca.gov/-/media/cal-advocates-website/files/press-room/reports-and-analyses/260210-public-advocates-office-q4-2025-rates-report.pdf ; Q1 2026 https://www.publicadvocates.cpuc.ca.gov/-/media/cal-advocates-website/files/press-room/reports-and-analyses/260430-public-advocates-office-q1-2026-electric-rates-report.pdf . A class average across all residential plans, not specific to E-TOU-C. No later PG&E change was found.$n$,
  avg_rate_verified_on = date '2026-10-25',
  avg_rate_verification = 'agent_sourced'
where id = 'pge';

update public.utilities set
  avg_rate_low = 0.312,
  avg_rate_likely = 0.345,
  avg_rate_high = 0.353,
  avg_rate_note = $n$Likely = 34.5 cents per kWh, SCE's own Rate Advisory for the residential rate change effective October 1, 2026 (current 34.4, new 34.5 cents/kWh excluding the Climate Credit; 33.3 with it). This replaces 0.344, the June 2026 figure in the Public Advocates Office (CPUC) Q2 2026 Electric Rates Report (https://www.publicadvocates.cpuc.ca.gov/-/media/cal-advocates-website/files/press-room/reports-and-analyses/260727-public-advocates-office-q2-2026-electric-rates-report.pdf). Low / high = lowest and highest of the residential average rates (excluding the Climate Credit) in the Public Advocates Office reports for June 2025, October 2025, January 2026, March 2026 and June 2026: $0.312, $0.353, $0.345, $0.345, $0.344 per kWh (Q2 2025: https://publicadvocatesa.cpuc.ca.gov/-/media/cal-advocates-website/files/press-room/reports-and-analyses/250827-public-advocates-office-q2-2025-rates-report.pdf ; Q3 2025: https://www.publicadvocates.cpuc.ca.gov/-/media/cal-advocates-website/files/press-room/reports-and-analyses/251106-public-advocates-office-q3-2025-rates-report.pdf ; Q4 2025: https://www.publicadvocates.cpuc.ca.gov/-/media/cal-advocates-website/files/press-room/reports-and-analyses/260210-public-advocates-office-q4-2025-rates-report.pdf ; Q1 2026: https://www.publicadvocates.cpuc.ca.gov/-/media/cal-advocates-website/files/press-room/reports-and-analyses/260430-public-advocates-office-q1-2026-electric-rates-report.pdf). The range is the observed ~12-month range, not a forecast. Class average across all residential plans, not specific to TOU-D-4-9PM.$n$,
  avg_rate_source_url = 'https://www.sce.com/save-money/rates-financing/sce-rate-advisory',
  avg_rate_verified_on = date '2026-10-25',
  avg_rate_verification = 'agent_sourced'
where id = 'sce';

update public.utilities set
  avg_rate_low = 0.410,
  avg_rate_high = 0.457,
  avg_rate_note = $n$Likely = published residential average rate for SDG&E as of June 2026 in the Public Advocates Office (CPUC) Q2 2026 Electric Rates Report. Low / high = lowest and highest of the five residential average rates (excluding the California Climate Credit) printed in the Public Advocates Office reports for June 2025, October 2025, January 2026, March 2026 and June 2026: $0.415, $0.410, $0.457, $0.457, $0.455 per kWh. The range is the observed ~12-month range, not a forecast. Reports: Q2 2025 https://publicadvocatesa.cpuc.ca.gov/-/media/cal-advocates-website/files/press-room/reports-and-analyses/250827-public-advocates-office-q2-2025-rates-report.pdf ; Q3 2025 https://www.publicadvocates.cpuc.ca.gov/-/media/cal-advocates-website/files/press-room/reports-and-analyses/251106-public-advocates-office-q3-2025-rates-report.pdf ; Q4 2025 https://www.publicadvocates.cpuc.ca.gov/-/media/cal-advocates-website/files/press-room/reports-and-analyses/260210-public-advocates-office-q4-2025-rates-report.pdf ; Q1 2026 https://www.publicadvocates.cpuc.ca.gov/-/media/cal-advocates-website/files/press-room/reports-and-analyses/260430-public-advocates-office-q1-2026-electric-rates-report.pdf . SDG&E adjusted rates again effective August 1, 2026; that change's average rate was not found, so the likely value may lag. Class average across all residential plans, not specific to TOU-DR1.$n$,
  avg_rate_verified_on = date '2026-10-25',
  avg_rate_verification = 'agent_sourced'
where id = 'sdge';

-- SCE TOU prices: the consumer plan page was re-read on 2026-10-25 and still shows the same prices; SCE's
-- dated tariff sheets are only in a SharePoint folder that cannot be read, so the caveat stays.
update public.utilities set
  verified_on = date '2026-10-25',
  tou_note = $n$Prices as shown on SCE's Time-of-Use Residential Rate Plans page for 'TOU-D 4 PM to 9 PM', before the baseline credit and rounded to the nearest cent by SCE. Re-read on 2026-10-25 (after the October 1, 2026 change): the page still shows the same prices, but it is undated, so whether it reflects the October 1 change is unconfirmed.$n$,
  source_caveat = $n$Source is an undated consumer rate-plan page with prices rounded to the cent, not the dated tariff sheet (SCE's Schedule TOU-D sheets are only in a SharePoint folder that cannot be read). SCE's Rate Advisory (https://www.sce.com/save-money/rates-financing/sce-rate-advisory) announces a residential change effective October 1, 2026 (average 34.4 to 34.5 cents/kWh, about +1.5% on a 500 kWh TOU-D-4-9PM bill) but prints no per-period prices, so these prices may be out of date by about 1.5%.$n$
where id = 'sce';

-- ---------------------------------------------------------------- cost ranges (still null: no numeric source)
update public.cost_ranges set
  verified_on = date '2026-10-25',
  note = $n$Berkeley Lab median installed price for host-owned, stand-alone residential PV installed in $$ in 2025, from the chart label on slide 37 of the 2026 Data Update ('State-Level Differences in Installed Prices'). The chart draws 20th/80th percentile bars per state but prints no values for them; re-checked 2026-10-25 and no numeric state percentile table was found (the Tracking the Sun page and data viewer returned HTTP 403 to automated access, and reading values off the bar heights would be estimation). Low and high stay null. Caveat: the chart's dotted U.S. reference line sits near $3.0/W while slide 8 shows $3.6/W as the 2025 all-host-owned national median; confirm the state figure against the Berkeley Lab data viewer.$n$
where item = 'installed_cost_per_watt' and state in ('FL','CA');
update public.cost_ranges set note = replace(note, '$$', state) where item = 'installed_cost_per_watt' and note like '%$$%';

update public.cost_ranges set
  verified_on = date '2026-10-25',
  note = note || $n$ Re-checked 2026-10-25: the DOE page still presents 2025Q1 as the current benchmark (no 2026 benchmark), so there is still no higher figure and high stays null.$n$
where item = 'battery_installed_cost' and note not like '%Re-checked 2026-10-25%';
