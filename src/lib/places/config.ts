/**
 * Per-country settings for place pages. Structural only (URL words, locale, currency, which direction panels face):
 * no rates, counts or statistics live here (CLAUDE.md rule 1). Pure.
 *
 * URL patterns (confirmed against each pack's pages.csv):
 *   GB  /uk/solar-panels/<region>/<place>          hub /uk/solar-panels/<region>
 *   DE  /de/photovoltaik/<land>/<stadt>            hub /de/photovoltaik/<land>
 *   AU  /au/solar-payback/<state>/<place>          hub /au/solar-payback/<state>
 *   ES  /es/placas-solares/<ccaa>/<ciudad>         SE  /se/solceller/<lan>/<stad>
 *   IE  /ie/solar-payback/<county>/<town>          DK  /dk/solceller/<region>/<by>
 *   NO  /no/solceller/<fylke>/<by>                 FI  /fi/aurinkopaneelit/<maakunta>/<kaupunki>
 *   PL  /pl/fotovoltaika/<wojewodztwo>/<miasto>    CZ  /cz/fotovoltaika/<kraj>/<mesto>
 *   RO  /ro/panouri-fotovoltaice/<judet>/<oras>
 *   FR  /fr/panneaux-solaires/<region>/<ville>     NL  /nl/zonnepanelen/<provincie>/<gemeente>
 *
 * Ireland also has a page per county at the hub URL (/ie/solar-payback/<county>): a place whose slug equals its region
 * slug (see `countyPages`). Such a page replaces the hub list at that URL.
 */
export type PlaceCountryCode = 'GB' | 'DE' | 'AU' | 'ES' | 'IE' | 'SE' | 'DK' | 'NO' | 'FI' | 'PL' | 'CZ' | 'RO' | 'FR' | 'NL';

export interface PlaceCountry {
  code: PlaceCountryCode;
  /** URL segment (GB is served under /uk/). */
  segment: string;
  /** The topic word between the country and the region. */
  topic: string;
  /** BCP-47 locale for number, currency and date formatting. */
  locale: string;
  /** <html lang>. */
  htmlLang: string;
  currency: string;
  /** Which compass direction an equator-facing array faces. */
  facing: 'south' | 'north';
  /** ISO2 lowercase code used by the articles collection (`country:` in frontmatter). */
  articleCountry: string;
  /** A place whose slug equals its region slug is that region's own page, served at the hub URL. */
  countyPages?: boolean;
}

export const PLACE_COUNTRIES: readonly PlaceCountry[] = [
  { code: 'GB', segment: 'uk', topic: 'solar-panels', locale: 'en-GB', htmlLang: 'en-GB', currency: 'GBP', facing: 'south', articleCountry: 'gb' },
  { code: 'DE', segment: 'de', topic: 'photovoltaik', locale: 'de-DE', htmlLang: 'de', currency: 'EUR', facing: 'south', articleCountry: 'de' },
  { code: 'AU', segment: 'au', topic: 'solar-payback', locale: 'en-AU', htmlLang: 'en-AU', currency: 'AUD', facing: 'north', articleCountry: 'au' },
  { code: 'ES', segment: 'es', topic: 'placas-solares', locale: 'es-ES', htmlLang: 'es', currency: 'EUR', facing: 'south', articleCountry: 'es' },
  { code: 'IE', segment: 'ie', topic: 'solar-payback', locale: 'en-IE', htmlLang: 'en-IE', currency: 'EUR', facing: 'south', articleCountry: 'ie', countyPages: true },
  { code: 'SE', segment: 'se', topic: 'solceller', locale: 'sv-SE', htmlLang: 'sv', currency: 'SEK', facing: 'south', articleCountry: 'se' },
  { code: 'DK', segment: 'dk', topic: 'solceller', locale: 'da-DK', htmlLang: 'da', currency: 'DKK', facing: 'south', articleCountry: 'dk' },
  { code: 'NO', segment: 'no', topic: 'solceller', locale: 'nb-NO', htmlLang: 'nb', currency: 'NOK', facing: 'south', articleCountry: 'no' },
  { code: 'FI', segment: 'fi', topic: 'aurinkopaneelit', locale: 'fi-FI', htmlLang: 'fi', currency: 'EUR', facing: 'south', articleCountry: 'fi' },
  { code: 'PL', segment: 'pl', topic: 'fotovoltaika', locale: 'pl-PL', htmlLang: 'pl', currency: 'PLN', facing: 'south', articleCountry: 'pl' },
  { code: 'CZ', segment: 'cz', topic: 'fotovoltaika', locale: 'cs-CZ', htmlLang: 'cs', currency: 'CZK', facing: 'south', articleCountry: 'cz' },
  { code: 'RO', segment: 'ro', topic: 'panouri-fotovoltaice', locale: 'ro-RO', htmlLang: 'ro', currency: 'RON', facing: 'south', articleCountry: 'ro' },
  { code: 'FR', segment: 'fr', topic: 'panneaux-solaires', locale: 'fr-FR', htmlLang: 'fr', currency: 'EUR', facing: 'south', articleCountry: 'fr' },
  { code: 'NL', segment: 'nl', topic: 'zonnepanelen', locale: 'nl-NL', htmlLang: 'nl', currency: 'EUR', facing: 'south', articleCountry: 'nl' },
];

export const placeCountryBySegment = (segment: string): PlaceCountry | null => PLACE_COUNTRIES.find((c) => c.segment === segment) ?? null;
export const placeCountryByCode = (code: string): PlaceCountry | null => PLACE_COUNTRIES.find((c) => c.code === code) ?? null;
/** Country for /<segment>/<topic>, or null when the topic word is not this country's place topic. */
export const placeCountryForRoute = (segment: string, topic: string): PlaceCountry | null => {
  const c = placeCountryBySegment(segment);
  return c && c.topic === topic ? c : null;
};

export const regionHubPath = (c: PlaceCountry, regionSlug: string): string => `/${c.segment}/${c.topic}/${regionSlug}`;
/** A county page (slug === region slug, countries with `countyPages`) lives at the hub URL; every other place one level below. */
export const isRegionPage = (c: PlaceCountry, regionSlug: string, slug: string): boolean => c.countyPages === true && slug === regionSlug;
export const placePath = (c: PlaceCountry, regionSlug: string, slug: string): string =>
  isRegionPage(c, regionSlug, slug) ? regionHubPath(c, regionSlug) : `/${c.segment}/${c.topic}/${regionSlug}/${slug}`;

/** Paths of place pages and region hubs for every configured country (sitemap classification). */
export const PLACE_PATH_RE = new RegExp(
  `^/(${PLACE_COUNTRIES.map((c) => `${c.segment}(?=/${c.topic}/)`).join('|')})/(?:${[...new Set(PLACE_COUNTRIES.map((c) => c.topic))].join('|')})/[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)?$`,
);
