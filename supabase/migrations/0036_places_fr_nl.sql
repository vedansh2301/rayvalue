-- RayValue place pages, third batch: FR (France) and NL (Netherlands).
-- APPLY ORDER: after 0033 (places, place_facts), 0034 (Europe markets) and 0025 (markets, regions). Seeds only; no schema change. Not applied by this commit.
--
-- 0034 left FR and NL out because their packs held no per-place data beyond a PVGIS yield. They now have it: INSEE
-- (recensement 2023, by commune) and ODRE for France, CBS StatLine (by gemeente) for the Netherlands, loaded with
-- `npm run places:fetch-local` and `npm run places:import` (see scripts/places/import-pack.ts).
--
-- Markets: currency, locale and default language are structural; yield_provider is pvgis (EU JRC), hemisphere N. VAT is
-- left NULL (the rate on domestic solar depends on system size and date, so it is entered later with a source_url +
-- verified_on like every other fact). published stays false (CLAUDE.md rule 9: the owner reviews before anything is public).
--
-- Regions: the page grouping each pack uses (FR: the 12 metropolitan regions plus Corse, ISO 3166-2:FR codes; NL: the 12
-- provinces, ISO 3166-2:NL codes). Names are place names, not statistics.

insert into public.markets (code, name, currency, locale, default_lang, yield_provider, hemisphere, prices_include_tax, published) values
  ('FR', 'France',      'EUR', 'fr-FR', 'fr', 'pvgis', 'N', null, false),
  ('NL', 'Netherlands', 'EUR', 'nl-NL', 'nl', 'pvgis', 'N', null, false)
on conflict (code) do nothing;

insert into public.regions (country, code, name, slug, published) values
  ('FR', 'IDF', 'Île-de-France', 'ile-de-france', false),
  ('FR', 'ARA', 'Auvergne-Rhône-Alpes', 'auvergne-rhone-alpes', false),
  ('FR', 'PAC', 'Provence-Alpes-Côte d''Azur', 'provence-alpes-cote-d-azur', false),
  ('FR', 'OCC', 'Occitanie', 'occitanie', false),
  ('FR', 'NAQ', 'Nouvelle-Aquitaine', 'nouvelle-aquitaine', false),
  ('FR', 'PDL', 'Pays de la Loire', 'pays-de-la-loire', false),
  ('FR', 'BRE', 'Bretagne', 'bretagne', false),
  ('FR', 'NOR', 'Normandie', 'normandie', false),
  ('FR', 'HDF', 'Hauts-de-France', 'hauts-de-france', false),
  ('FR', 'GES', 'Grand Est', 'grand-est', false),
  ('FR', 'BFC', 'Bourgogne-Franche-Comté', 'bourgogne-franche-comte', false),
  ('FR', 'CVL', 'Centre-Val de Loire', 'centre-val-de-loire', false),
  ('FR', 'COR', 'Corse', 'corse', false),
  ('NL', 'GR', 'Groningen', 'groningen', false),
  ('NL', 'FR', 'Fryslân', 'friesland', false),
  ('NL', 'DR', 'Drenthe', 'drenthe', false),
  ('NL', 'OV', 'Overijssel', 'overijssel', false),
  ('NL', 'FL', 'Flevoland', 'flevoland', false),
  ('NL', 'GE', 'Gelderland', 'gelderland', false),
  ('NL', 'UT', 'Utrecht', 'utrecht', false),
  ('NL', 'NH', 'Noord-Holland', 'noord-holland', false),
  ('NL', 'ZH', 'Zuid-Holland', 'zuid-holland', false),
  ('NL', 'ZE', 'Zeeland', 'zeeland', false),
  ('NL', 'NB', 'Noord-Brabant', 'noord-brabant', false),
  ('NL', 'LI', 'Limburg', 'limburg', false)
on conflict (country, code) do nothing;

notify pgrst, 'reload schema';
