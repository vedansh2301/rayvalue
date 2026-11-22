/**
 * Data shaping for the global home page (/): the country picker, calculators strip, deadline guides and latest guides.
 * Pure: the page passes plain objects read from the content collections and the place index. Every count is computed
 * from those inputs; nothing numeric is typed here (CLAUDE.md rule 1). The only hand-written data is structural: which
 * world region a country segment belongs to, and which published guides are the "deadline" guides.
 */
import { articleIndexPath, articlePath, articleSlug, countrySegment } from '../content/paths.ts';
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
  /** Last day of a dated deadline the article is about (frontmatter `deadline`). */
  deadline?: Date | null;
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
export function groupByRegion<T extends { region: Region | null }>(cards: readonly T[]): { region: Region | 'Other'; cards: T[] }[] {
  const out: { region: Region | 'Other'; cards: T[] }[] = REGIONS.map((region) => ({ region, cards: cards.filter((c) => c.region === region) }));
  out.push({ region: 'Other', cards: cards.filter((c) => c.region === null) });
  return out.filter((g) => g.cards.length > 0);
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
/** Count line for a country card, e.g. "12 guides, 4 posts, 31 places"; zero counts are omitted. */
export function cardCounts(c: Pick<CountryCard, 'guides' | 'blog' | 'places'>): string {
  const parts: string[] = [];
  if (c.guides > 0) parts.push(plural(c.guides, 'guide'));
  if (c.blog > 0) parts.push(plural(c.blog, 'post'));
  if (c.places > 0) parts.push(plural(c.places, 'place'));
  return parts.join(', ');
}

/** Content volume of a country card: what the "top countries" chooser ranks by. */
export const cardWeight = (c: Pick<CountryCard, 'guides' | 'blog' | 'places'>): number => c.guides + c.blog + c.places;

/** The `limit` countries with the most published content (ties by name), for the quick chooser above the fold. */
export function topCountries(cards: readonly CountryCard[], limit = 8): CountryCard[] {
  return [...cards].sort((a, b) => cardWeight(b) - cardWeight(a) || a.name.localeCompare(b.name)).slice(0, limit);
}

export interface SiteTotals { countries: number; guides: number; posts: number; places: number }

/** Totals shown on the home page, summed from the same cards the picker lists (so they always match what is linked). */
export function siteTotals(cards: readonly CountryCard[]): SiteTotals {
  return cards.reduce<SiteTotals>((t, c) => ({ countries: t.countries + 1, guides: t.guides + c.guides, posts: t.posts + c.blog, places: t.places + c.places }), { countries: 0, guides: 0, posts: 0, places: 0 });
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

export type ArticleKind = 'deadline' | 'battery' | 'guide';
export interface ArticleLink {
  href: string; title: string; description: string; lang: string; country: string; countryName: string;
  collection: 'guides' | 'blog'; id: string; deadline: Date | null; kind: ArticleKind;
}

const BATTERY_RE = /batter|batería|bateria|akku|speicher|accu\b/i;
const isDeadlineGuide = (a: HomeArticle): boolean => DEADLINE_GUIDES.some((d) => d.collection === a.collection && d.country === a.country.toLowerCase() && articleSlug(a.id, d.country) === d.slug);

/** Tag for a card: dated-deadline guides, battery guides (by title or slug), everything else a plain guide. */
export function articleKind(a: HomeArticle): ArticleKind {
  if (a.deadline || isDeadlineGuide(a)) return 'deadline';
  return BATTERY_RE.test(`${a.id} ${a.title}`) ? 'battery' : 'guide';
}

const toLink = (a: HomeArticle): ArticleLink => {
  const seg = segOf(a);
  return { href: articlePath(a.collection, a.id, a.route, a.country), title: a.title, description: a.description, lang: a.lang, country: seg, countryName: countryName(seg, 'en'), collection: a.collection, id: a.id, deadline: a.deadline ?? null, kind: articleKind(a) };
};

/** The deadline guides that are live (published, indexable), in editorial order. Missing or noindex ones are skipped. */
export function deadlineLinks(articles: readonly HomeArticle[], country?: string): ArticleLink[] {
  const out: ArticleLink[] = [];
  const want = country ? (country.toLowerCase() === 'uk' ? 'gb' : country.toLowerCase()) : null;
  for (const d of DEADLINE_GUIDES) {
    if (want && d.country !== want) continue;
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

export interface HomeCalculator { href: string; country: string; segment: string; label: string; fact: string }

/** Calculators that are live: the two US state calculators and every non-US country calculator that exists. */
export function liveCalculators(): HomeCalculator[] {
  const out: HomeCalculator[] = [
    { href: calcPath('FL'), country: 'United States', segment: 'us', label: 'Florida', fact: 'Net metering and tiered utility rates' },
    { href: calcPath('CA'), country: 'United States', segment: 'us', label: 'California', fact: 'NEM 3.0 export rates and batteries' },
  ];
  const intl: { code: string; country: string; fact: string }[] = [
    { code: 'uk', country: 'United Kingdom', fact: 'Price cap and Smart Export Guarantee' },
    { code: 'de', country: 'Germany', fact: 'EEG feed-in tariff, batteries and 0% VAT' },
    { code: 'au', country: 'Australia', fact: 'Network prices, feed-in rates and the battery rebate' },
  ];
  for (const c of intl) {
    const calc = countryCalculator(c.code);
    if (calc) out.push({ href: calc.href, country: c.country, segment: c.code, label: c.country, fact: c.fact });
  }
  return out;
}

export interface CardChip { label: string; href: string; kind: 'calc' | 'deadline' | 'guides'; aria?: string; lang?: string }

/**
 * Shortcut chips for a country card: its calculator(s) when they exist, the nearest deadline guide (first in editorial
 * order) and its guides index (only when the country has guides).
 */
export function cardChips(c: Pick<CountryCard, 'segment' | 'name' | 'guides'>, articles: readonly HomeArticle[]): CardChip[] {
  const out: CardChip[] = [];
  if (c.segment === US_SEGMENT) {
    out.push({ label: 'Florida', href: calcPath('FL'), kind: 'calc', aria: 'Florida solar calculator' });
    out.push({ label: 'California', href: calcPath('CA'), kind: 'calc', aria: 'California solar calculator' });
  } else {
    const calc = countryCalculator(c.segment);
    if (calc) out.push({ label: 'Calculator', href: calc.href, kind: 'calc', aria: `${c.name} solar calculator` });
  }
  const d = deadlineLinks(articles, c.segment)[0];
  if (d) out.push({ label: d.title, href: d.href, kind: 'deadline', lang: d.lang });
  if (c.guides > 0) out.push({ label: 'Guides', href: articleIndexPath('guides', c.segment === US_SEGMENT ? 'us' : c.segment), kind: 'guides', aria: `${c.name} guides` });
  return out;
}

const DAY_MS = 86_400_000;
const utcDay = (d: Date): number => Math.floor(d.getTime() / DAY_MS);

/** Whole days from `now` to the deadline day (0 on the day itself); null once it has passed. */
export function daysLeft(deadline: Date, now: Date): number | null {
  const n = utcDay(deadline) - utcDay(now);
  return n < 0 ? null : n;
}

/** Width (6..100) of the urgency bar: the share of the final 180 days already used up. A visual cue only, no claim. */
export function urgencyPct(days: number): number {
  return Math.round(Math.min(100, Math.max(6, 100 - days / 1.8)));
}

export interface DeadlineCard extends ArticleLink { days: number; pct: number }

/** Deadline guides that have a stated, still-future date, soonest first. Guides with no date are left out of this view. */
export function upcomingDeadlines(links: readonly ArticleLink[], now: Date): DeadlineCard[] {
  const out: DeadlineCard[] = [];
  for (const l of links) {
    if (!l.deadline) continue;
    const days = daysLeft(l.deadline, now);
    if (days === null) continue;
    out.push({ ...l, days, pct: urgencyPct(days) });
  }
  return out.sort((a, b) => a.days - b.days || a.country.localeCompare(b.country));
}

export interface Destination {
  /** Select value: the country segment, or `us-fl` / `us-ca` for the two US calculators. */
  key: string;
  segment: string;
  label: string;
  href: string;
  /** What the link does, for the button text. */
  action: string;
  kind: 'calc' | 'hub';
}

/**
 * Where "show my payback" goes for each country: its calculator when one exists, otherwise its hub (guides and local
 * pages). The US has two state calculators, so it appears twice. Sorted by label.
 */
export function homeDestinations(cards: readonly Pick<CountryCard, 'segment' | 'name' | 'href'>[]): Destination[] {
  const out: Destination[] = [];
  for (const c of cards) {
    if (c.segment === US_SEGMENT) {
      out.push({ key: 'us-fl', segment: 'us', label: 'United States: Florida', href: calcPath('FL'), action: 'Open the Florida calculator', kind: 'calc' });
      out.push({ key: 'us-ca', segment: 'us', label: 'United States: California', href: calcPath('CA'), action: 'Open the California calculator', kind: 'calc' });
      continue;
    }
    const calc = countryCalculator(c.segment);
    out.push(calc
      ? { key: c.segment, segment: c.segment, label: c.name, href: calc.href, action: `Open the ${c.name} calculator`, kind: 'calc' }
      : { key: c.segment, segment: c.segment, label: c.name, href: c.href, action: `See ${c.name} guides`, kind: 'hub' });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** Newest live blog posts across countries, at most `perCountry` from any one country. */
export function latestPostLinks(articles: readonly HomeArticle[], limit = 5, perCountry = 2): ArticleLink[] {
  const sorted = articles.filter((a) => isLive(a) && a.collection === 'blog').sort((a, b) => stamp(b) - stamp(a) || a.id.localeCompare(b.id));
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
