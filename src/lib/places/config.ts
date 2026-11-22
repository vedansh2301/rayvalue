/**
 * Per-country settings for place pages. Structural only (URL words, locale, currency, which direction panels face):
 * no rates, counts or statistics live here (CLAUDE.md rule 1). Pure.
 *
 * URL patterns (confirmed against each pack's pages.csv):
 *   GB  /uk/solar-panels/<region>/<place>      hub /uk/solar-panels/<region>
 *   DE  /de/photovoltaik/<land>/<stadt>        hub /de/photovoltaik/<land>
 *   AU  /au/solar-payback/<state>/<place>      hub /au/solar-payback/<state>
 */
export type PlaceCountryCode = 'GB' | 'DE' | 'AU';

export interface PlaceCountry {
  code: PlaceCountryCode;
  /** URL segment (GB is served under /uk/). */
  segment: 'uk' | 'de' | 'au';
  /** The topic word between the country and the region. */
  topic: string;
  /** BCP-47 locale for number, currency and date formatting. */
  locale: string;
  /** <html lang>. */
  htmlLang: string;
  currency: 'GBP' | 'EUR' | 'AUD';
  /** Which compass direction an equator-facing array faces. */
  facing: 'south' | 'north';
  /** ISO2 lowercase code used by the articles collection (`country:` in frontmatter). */
  articleCountry: 'gb' | 'de' | 'au';
}

export const PLACE_COUNTRIES: readonly PlaceCountry[] = [
  { code: 'GB', segment: 'uk', topic: 'solar-panels', locale: 'en-GB', htmlLang: 'en-GB', currency: 'GBP', facing: 'south', articleCountry: 'gb' },
  { code: 'DE', segment: 'de', topic: 'photovoltaik', locale: 'de-DE', htmlLang: 'de', currency: 'EUR', facing: 'south', articleCountry: 'de' },
  { code: 'AU', segment: 'au', topic: 'solar-payback', locale: 'en-AU', htmlLang: 'en-AU', currency: 'AUD', facing: 'north', articleCountry: 'au' },
];

export const placeCountryBySegment = (segment: string): PlaceCountry | null => PLACE_COUNTRIES.find((c) => c.segment === segment) ?? null;
export const placeCountryByCode = (code: string): PlaceCountry | null => PLACE_COUNTRIES.find((c) => c.code === code) ?? null;
/** Country for /<segment>/<topic>, or null when the topic word is not this country's place topic. */
export const placeCountryForRoute = (segment: string, topic: string): PlaceCountry | null => {
  const c = placeCountryBySegment(segment);
  return c && c.topic === topic ? c : null;
};

export const placePath = (c: PlaceCountry, regionSlug: string, slug: string): string => `/${c.segment}/${c.topic}/${regionSlug}/${slug}`;
export const regionHubPath = (c: PlaceCountry, regionSlug: string): string => `/${c.segment}/${c.topic}/${regionSlug}`;

/** Paths of place pages and region hubs for every configured country (sitemap classification). */
export const PLACE_PATH_RE = new RegExp(
  `^/(${PLACE_COUNTRIES.map((c) => `${c.segment}(?=/${c.topic}/)`).join('|')})/(?:${PLACE_COUNTRIES.map((c) => c.topic).join('|')})/[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)?$`,
);
