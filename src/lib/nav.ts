/**
 * Site navigation, pure. One global header everywhere (logo, Countries menu, Calculators, Guides, Methodology) plus a
 * "context" row that depends on where you are:
 *   - country pages (/uk, /de, ...): that country's overview, calculator, guides and blog, in the page language;
 *   - US pages (/us, /quotes, US articles, stories): the US overview, state calculators, guides, blog, stories and the
 *     US-only "Get quotes" lead CTA (consent and buyers exist only for the US);
 *   - everything else: no context row. Never a "Get quotes" link outside US pages.
 */
import { calcPath } from './paths.ts';
import { articleIndexPath } from './content/paths.ts';
import { countryCalculator } from './content/country-calc.ts';
import { countryFromPath, countryName, countryNav, US_SEGMENT, hubPath } from './content/country-nav.ts';
import { uiText } from './i18n/ui.ts';
import { REGION_BY_SEGMENT, groupByRegion } from './home/global-home.ts';

export interface NavLink {
  href: string;
  label: string;
}

export type NavKind = 'global' | 'us' | 'country';

const norm = (path: string): string => path.replace(/\/+$/, '') || '/';

/** Path prefixes that are US-only pages (state calculators, quote funnel, stories, alerts, outbound /go links). */
const US_PREFIXES = ['/us', '/quotes', '/stories', '/alerts', '/go'] as const;

/**
 * True for pages that belong to the US: /us/**, the quote funnel, stories, alerts, and US article pages
 * (/guides/<slug>, /blog/<slug>). The /guides and /blog indexes are global (every country), so they are not US pages.
 */
export function isUsPath(path: string): boolean {
  const p = norm(path);
  if (US_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`))) return true;
  return /^\/(guides|blog)\/[^/]+/.test(p);
}

/** True for pages that belong to no single country (/, /about, /methodology, /guides, /blog, legal pages, 404). */
export function isGlobalPath(path: string): boolean {
  return !isUsPath(path) && norm(path).split('/')[1] !== US_SEGMENT;
}

/** Top-level links of the global header, in order. Countries is a menu in the header, so it is listed by label only. */
export const GLOBAL_NAV: readonly (NavLink & { key: 'countries' | 'calculators' | 'guides' | 'blog' | 'methodology' })[] = [
  { key: 'countries', href: '/#countries', label: 'Countries' },
  { key: 'calculators', href: '/#calculators', label: 'Calculators' },
  { key: 'guides', href: '/guides', label: 'Guides' },
  { key: 'blog', href: '/blog', label: 'Blog' },
  { key: 'methodology', href: '/methodology', label: 'Methodology' },
];

export interface NavContext {
  kind: NavKind;
  /** URL segment of the country ('us' for the US), null on global pages. */
  segment: string | null;
  /** Country name in the page language, null on global pages. */
  name: string | null;
  /** Context links; empty on global pages. */
  links: NavLink[];
  /** The US-only quote CTA; null everywhere else. */
  cta: NavLink | null;
}

export interface NavContextInput {
  path: string;
  /** Non-US segments that have published content (the countries a country context can apply to). */
  known: readonly string[];
  counts: ReadonlyMap<string, { guides: number; blog: number }>;
  lang?: string;
}

export interface CountryMenuGroup { region: string; items: { href: string; name: string; segment: string; current: boolean }[] }

/**
 * Countries for the header menu and the footer, grouped by world region (REGIONS order), names in English, sorted by
 * name. `segments` are the countries that have a live hub (the US is added by the caller as 'us').
 */
export function countryMenu(segments: readonly string[], current: string | null = null): CountryMenuGroup[] {
  const groups = groupByRegion(
    [...new Set(segments)].map((segment) => ({ segment, region: REGION_BY_SEGMENT[segment] ?? null, name: countryName(segment, 'en') })),
  );
  return groups.map((g) => ({
    region: g.region,
    items: g.cards
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ href: hubPath(c.segment), name: c.name, segment: c.segment, current: c.segment === current })),
  }));
}

export interface SwitcherItem { segment: string; name: string; href: string; current: boolean }

/**
 * Countries for the header country switcher: the published hubs (`segments`, the US included) plus the current one, each
 * with its hub link, sorted by English name. The current country is flagged so the menu can highlight it.
 */
export function switcherItems(segments: readonly string[], current: string | null): SwitcherItem[] {
  return [...new Set(current ? [...segments, current] : segments)]
    .map((segment) => ({ segment, name: countryName(segment, 'en'), href: hubPath(segment), current: segment === current }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** What the header's second row shows for a path. */
export function navContext(i: NavContextInput): NavContext {
  const path = norm(i.path);
  const lang = i.lang ?? 'en';
  const seg = countryFromPath(path, i.known);
  if (seg) {
    const t = uiText(lang);
    const c = i.counts.get(seg) ?? { guides: 0, blog: 0 };
    const nav = countryNav({ segment: seg, lang, counts: c, countries: i.known });
    const calc = countryCalculator(seg);
    const links: NavLink[] = [
      { href: nav.home.href, label: t.home },
      ...(calc ? [{ href: calc.href, label: t.calculator }] : []),
      ...nav.links,
    ];
    return { kind: 'country', segment: seg, name: countryName(seg, lang), links, cta: null };
  }
  if (isUsPath(path) || path.split('/')[1] === US_SEGMENT) {
    return {
      kind: 'us',
      segment: US_SEGMENT,
      name: countryName(US_SEGMENT, 'en'),
      links: [
        { href: hubPath(US_SEGMENT), label: 'Overview' },
        { href: calcPath('FL'), label: 'Florida calculator' },
        { href: calcPath('CA'), label: 'California calculator' },
        { href: `${articleIndexPath('guides')}#united-states`, label: 'Guides' },
        { href: `${articleIndexPath('blog')}#united-states`, label: 'Blog' },
        { href: '/stories', label: 'Stories' },
      ],
      cta: { href: '/quotes', label: 'Get quotes' },
    };
  }
  return { kind: 'global', segment: null, name: null, links: [], cta: null };
}
