-- RayValue place pages, fourth batch: IT (Italy) and CH (Switzerland, German-language pages).
-- APPLY ORDER: after 0033 (places, place_facts), 0034 and 0036 and 0025 (markets, regions). Seeds only; no schema change. Not applied by this commit.
--
-- Local data comes from `npm run places:fetch-local-it-ch` (ISTAT permanent census by comune for Italy; ElCom 2027 tariff and the
-- BFE register of PV plants by Gemeinde for Switzerland) and `npm run places:import` (see scripts/places/import-pack.ts).
--
-- Markets: currency, locale and default language are structural; yield_provider is pvgis (EU JRC), hemisphere N. VAT is left NULL
-- (entered later with a source_url + verified_on like every other fact). published stays false (CLAUDE.md rule 9).
--
-- Regions: the grouping each pack uses (IT: the 20 regions, ISTAT region codes; CH: the 9 cantons the German pages cover, ISO
-- 3166-2:CH codes). Names are place names, not statistics.

insert into public.markets (code, name, currency, locale, default_lang, yield_provider, hemisphere, prices_include_tax, published) values
  ('IT', 'Italy',       'EUR', 'it-IT', 'it', 'pvgis', 'N', null, false),
  ('CH', 'Switzerland', 'CHF', 'de-CH', 'de', 'pvgis', 'N', null, false)
on conflict (code) do nothing;

insert into public.regions (country, code, name, slug, published) values
  ('IT', '21', 'Piemonte', 'piemonte', false),
  ('IT', '23', 'Valle d''Aosta', 'valle-d-aosta', false),
  ('IT', '25', 'Lombardia', 'lombardia', false),
  ('IT', '32', 'Trentino-Alto Adige', 'trentino-alto-adige', false),
  ('IT', '34', 'Veneto', 'veneto', false),
  ('IT', '36', 'Friuli-Venezia Giulia', 'friuli-venezia-giulia', false),
  ('IT', '42', 'Liguria', 'liguria', false),
  ('IT', '45', 'Emilia-Romagna', 'emilia-romagna', false),
  ('IT', '52', 'Toscana', 'toscana', false),
  ('IT', '55', 'Umbria', 'umbria', false),
  ('IT', '57', 'Marche', 'marche', false),
  ('IT', '62', 'Lazio', 'lazio', false),
  ('IT', '65', 'Abruzzo', 'abruzzo', false),
  ('IT', '67', 'Molise', 'molise', false),
  ('IT', '72', 'Campania', 'campania', false),
  ('IT', '75', 'Puglia', 'puglia', false),
  ('IT', '77', 'Basilicata', 'basilicata', false),
  ('IT', '78', 'Calabria', 'calabria', false),
  ('IT', '82', 'Sicilia', 'sicilia', false),
  ('IT', '88', 'Sardegna', 'sardegna', false),
  ('CH', 'ZH', 'Zürich', 'zuerich', false),
  ('CH', 'BE', 'Bern', 'bern', false),
  ('CH', 'LU', 'Luzern', 'luzern', false),
  ('CH', 'ZG', 'Zug', 'zug', false),
  ('CH', 'BS', 'Basel-Stadt', 'basel-stadt', false),
  ('CH', 'SH', 'Schaffhausen', 'schaffhausen', false),
  ('CH', 'SG', 'St. Gallen', 'st-gallen', false),
  ('CH', 'GR', 'Graubünden', 'graubuenden', false),
  ('CH', 'AG', 'Aargau', 'aargau', false)
on conflict (country, code) do nothing;

notify pgrst, 'reload schema';
