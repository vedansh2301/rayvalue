-- CA battery_installed_cost.high from Berkeley Lab's 2026 Data Update (slide 9): median cash-purchase residential
-- PV+storage price is $2.1/W (of PV) higher than stand-alone PV; ~80% of that data is from California.
-- $2.1/W x 8,000 Wdc (the DOE benchmark system size used for low/likely) = $16,800.
-- FL stays null: the LBNL pairing data is ~80% CA and says nothing state-level for FL.
update public.cost_ranges set
  high = 16800,
  verified_on = date '2026-10-25',
  verification = 'agent_sourced',
  note = note || $n$ High (added 2026-10-25) = $16,800 = $2.1/W x 8,000 Wdc. Source for the $2.1/W: Berkeley Lab Tracking the Sun 2026 Data Update, slide 9 ('Installed Prices for Paired PV+storage Systems'): among cash-purchase residential systems, median 2025 prices were $2.1/W higher for paired PV+storage than stand-alone PV; about 80% of the paired-system pricing data are from California; the differential is smaller for loan-financed systems. URL: https://eta-publications.lbl.gov/sites/default/files/2026-08/distributed_solar_storage-2026_data_update_final.pdf . Caveats: it is a median premium (not a percentile) per watt of PV, and multiplying by 8 kWdc is our assumption; it is a premium for the whole storage addition, the 2025 median battery is 13.5 kWh. The likely ($13,120) comes from a national modeled benchmark and sits well below this California cash-purchase median, so it may be low for California; it was left unchanged because the two methods are not directly comparable.$n$
where state = 'CA' and item = 'battery_installed_cost';
notify pgrst, 'reload schema';
