/**
 * Data shaping for the global home page (/): the country picker, calculators strip, deadline guides and latest guides.
 * Pure: the page passes plain objects read from the content collections and the place index. Every count is computed
 * from those inputs; nothing numeric is typed here (CLAUDE.md rule 1). The only hand-written data is structural: which
 * world region a country segment belongs to, and which published guides are the "deadline" guides.
 */
import { articlePath, articleSlug, countrySegment } from '../content/paths.ts';
import { countryName, hubIndexable, hubItemCount, hubPath, US_SEGMENT } from '../content/country-nav.ts';
import { countryCalculator } from '../content/country-calc.ts';
import { calcPath } from '../paths.ts';

export const REGIONS = ['Europe', 'Americas', 'Asia-Pacific', 'Africa & Middle East'] as const;
export type Region = (typeof REGIONS)[number];

/** Structural grouping by URL segment (GB is "uk"). A content country missing here is a test failure, not a silent drop. */
export const REGION_BY_SEGMENT: Readonly<Record<string, Region>> = {
  uk: 'Europe', ie: 'Europe', de: 'Europe', at: 'Europe', ch: 'Europe', fr: 'Europe', be: 'Europe', nl: 'Europe', es: 'Europe', pt: 'Europe', it: 'Europe',
  se: 'Europe', dk: 'Europe', no: 'Europe', fi: 'Europe', pl: 'Europe', cz: 'Europe', ro: 'Europe',
  us: 'Americas', ca: 'Americas', br: 'Americas', cl: 'Americas', co: 'Americas', ar: 'Americas', pe: 'Americas', do: 'Americas', jm: 'Americas',
  au: 'Asia-Pacific', jp: 'Asia-Pacific', in: 'Asia-Pacific',
  za: 'Africa & Middle East', il: 'Africa & Middle East',
};

export interface HomeArticle {
  collection: 'guides' | 'blog';
  id: string;
  route?: string;
  country: string;
  lang: string;
  title: string;
  description: string;
  published?: Date | null;
  updated?: Date | null;
  draft?: boolean;
  noindex?: boolean;
}

const isLive = (a: HomeArticle): boolean => !a.draft && !a.noindex;
const stamp = (a: HomeArticle): number => (a.updated ?? a.published ?? new Date(0)).getTime();
const segOf = (a: HomeArticle): string => (a.country.toLowerCase() === 'us' ? US_SEGMENT : countrySegment(a.country));

export interface CountryCard {
  segment: string;
  href: string;
  /** English name, e.g. "Germany". */
  name: string;
  /** Name in the country's main content language ("Deutschland"); null when it equals the English name. */
  localName: string | null;
  /** Language subtag for the local name, for the lang attribute. */
  localLang: string | null;
  region: Region | null;
  guides: number;
  blog: number;
  /** Published place or city pages. */
  places: number;
  /** Region hubs of place pages (they count toward the hub's indexability, as on the hub page itself). */
  placeHubs: number;
}

export interface PlaceCounts { places: number; hubs: number }

/** The language most of a country's articles are written in (ties: alphabetical), as a BCP47 tag. */
function mainLang(list: readonly HomeArticle[]): string {
  const n = new Map<string, number>();
  for (const a of list) n.set(a.lang, (n.get(a.lang) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
}

/**
 * One card per country with an indexable hub (>= HUB_MIN_ITEMS items: guides + blog + place hubs, the same rule the hub
 * page uses for noindex), so the picker never links a thin or noindex hub. The US card is always present: its hub is /us.
 */
export function buildCountryCards(articles: readonly HomeArticle[], places: Readonly<Record<string, PlaceCounts>> = {}, us: { places: number } = { places: 0 }): CountryCard[] {
  const live = articles.filter(isLive);
  const segs = [...new Set(live.map(segOf))];
  const cards: CountryCard[] = [];
  for (const seg of segs) {
    const mine = live.filter((a) => segOf(a) === seg);
    const guides = mine.filter((a) => a.collection === 'guides').length;
    const blog = mine.length - guides;
    const p = seg === US_SEGMENT ? { places: us.places, hubs: 0 } : (places[seg] ?? { places: 0, hubs: 0 });
    if (seg !== US_SEGMENT && !hubIndexable(hubItemCount({ guides, blog, placeHubs: p.hubs }))) continue;
    const base = mainLang(mine).split('-')[0]!;
    const name = countryName(seg, 'en');
    const local = base === 'en' ? name : countryName(seg, base);
    cards.push({
      segment: seg, href: hubPath(seg), name,
      localName: local !== name ? local : null,
      localLang: local !== name ? base : null,
      region: REGION_BY_SEGMENT[seg] ?? null,
      guides, blog, places: p.places, placeHubs: p.hubs,
    });
  }
  return cards.sort((a, b) => a.name.localeCompare(b.name));
}

/** Cards grouped by world region in the fixed REGIONS order; empty groups are dropped. A card with no region goes last under "Other". */
export function groupByRegion(cards: readonly CountryCard[]): { region: Region | 'Other'; cards: CountryCard[] }[] {
  const out: { region: Region | 'Other'; cards: CountryCard[] }[] = REGIONS.map((region) => ({ region, cards: cards.filter((c) => c.region === region) }));
  out.push({ region: 'Other', cards: cards.filter((c) => c.region === null) });
  return out.filter((g) => g.cards.length > 0);
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
/** Count line for a country card, e.g. "12 guides · 4 posts · 31 places"; zero counts are omitted. */
export function cardCounts(c: Pick<CountryCard, 'guides' | 'blog' | 'places'>): string {
  const parts: string[] = [];
  if (c.guides > 0) parts.push(plural(c.guides, 'guide'));
  if (c.blog > 0) parts.push(plural(c.blog, 'post'));
  if (c.places > 0) parts.push(plural(c.places, 'place'));
  return parts.join(' · ');
}

/** The published guides about a dated deadline. Which articles those are is an editorial list; titles and text come from frontmatter. */
export const DEADLINE_GUIDES: readonly { collection: 'guides' | 'blog'; country: string; slug: string }[] = [
  { collection: 'guides', country: 'gb', slug: 'solar-panels-vat-deadline-2027' },
  { collection: 'guides', country: 'nl', slug: 'einde-salderingsregeling-1-januari-2027' },
  { collection: 'guides', country: 'es', slug: 'deduccion-irpf-placas-solares-antes-31-diciembre' },
  { collection: 'guides', country: 'it', slug: 'detrazione-fotovoltaico-2027' },
  { collection: 'guides', country: 'au', slug: 'battery-rebate-changes-2027' },
  { collection: 'guides', country: 'in', slug: 'pm-surya-ghar-last-date' },
  { collection: 'guides', country: 'us', slug: 'california-solar-property-tax-exclusion-ends-2027' },
  { collection: 'blog', country: 'gb', slug: 'eco4-ending-december-2026' },
];

export interface ArticleLink { href: string; title: string; description: string; lang: string; country: string; countryName: string }

const toLink = (a: HomeArticle): ArticleLink => {
  const seg = segOf(a);
  return { href: articlePath(a.collection, a.id, a.route, a.country), title: a.title, description: a.description, lang: a.lang, country: seg, countryName: countryName(seg, 'en') };
};

/** The deadline guides that are live (published, indexable), in editorial order. Missing or noindex ones are skipped. */
export function deadlineLinks(articles: readonly HomeArticle[]): ArticleLink[] {
  const out: ArticleLink[] = [];
  for (const d of DEADLINE_GUIDES) {
    const hit = articles.find((a) => isLive(a) && a.collection === d.collection && a.country.toLowerCase() === d.country && articleSlug(a.id, d.country) === d.slug);
    if (hit) out.push(toLink(hit));
  }
  return out;
}

/** Newest live guides across all countries, at most `perCountry` from any one country so the list shows the spread. */
export function latestGuideLinks(articles: readonly HomeArticle[], limit = 6, perCountry = 1): ArticleLink[] {
  const sorted = articles.filter((a) => isLive(a) && a.collection === 'guides').sort((a, b) => stamp(b) - stamp(a) || a.id.localeCompare(b.id));
  const used = new Map<string, number>();
  const out: ArticleLink[] = [];
  for (const a of sorted) {
    const l = toLink(a);
    if ((used.get(l.country) ?? 0) >= perCountry) continue;
    used.set(l.country, (used.get(l.country) ?? 0) + 1);
    out.push(l);
    if (out.length >= limit) break;
  }
  return out;
}

export interface HomeCalculator { href: string; country: string; label: string; fact: string }

/** Calculators that are live: the two US state calculators and every non-US country calculator that exists. */
export function liveCalculators(): HomeCalculator[] {
  const out: HomeCalculator[] = [
    { href: calcPath('FL'), country: 'United States', label: 'Florida', fact: 'Net metering and tiered utility rates' },
    { href: calcPath('CA'), country: 'United States', label: 'California', fact: 'NEM 3.0 export rates and batteries' },
  ];
  const intl: { code: string; country: string; fact: string }[] = [
    { code: 'uk', country: 'United Kingdom', fact: 'Price cap and Smart Export Guarantee' },
    { code: 'de', country: 'Germany', fact: 'EEG feed-in tariff, batteries and 0% VAT' },
    { code: 'au', country: 'Australia', fact: 'Network prices, feed-in rates and the battery rebate' },
  ];
  for (const c of intl) {
    const calc = countryCalculator(c.code);
    if (calc) out.push({ href: calc.href, country: c.country, label: c.country, fact: c.fact });
  }
  return out;
}
