/**
 * The single source of "what is indexable" for RayValue. The sitemap files, /llms.txt and the parity tests all read
 * the predicates and lists here, so a page can never be in one and not the others. Pure: no I/O, no Astro.
 *
 * Sitemap layout (root-level children, so a country is added by emitting more files, never by changing the index):
 *   /sitemap.xml                        <sitemapindex>
 *   /sitemap-<cc>-<type>.xml            e.g. sitemap-us-calculators.xml, -us-utilities, -us-cities, -us-articles
 *   /sitemap-<cc>-articles.xml          non-US guides and blog (e.g. sitemap-uk-articles.xml), only when non-empty
 *   /sitemap-<cc>-places.xml            non-US place pages and region hubs (e.g. sitemap-uk-places.xml), published + gated only
 *   /sitemap-global-pages.xml           home, guides, blog and the other country-independent pages
 */
import { UNREVIEWED_PAGES } from './unreviewed-pages.ts';
import { PAGE_META } from './page-meta.ts';
import { isGoPath } from '../go.ts';
import { UTILITY_PAGES, utilityPagePath } from '../utility/pages.ts';
import { US_BASE, taxPath } from '../paths.ts';
import { PLACE_PATH_RE } from '../places/config.ts';

export const SITE_ORIGIN = 'https://rayvalue.com';

export type PageType = 'pages' | 'calculators' | 'utilities' | 'cities' | 'articles' | 'places';
/** Where an entry is listed in /llms.txt. */
export type Section = 'home' | 'calculators' | 'utilities' | 'cities' | 'places' | 'guides' | 'blog' | 'tax' | 'about';
/** 'us', 'global', or the URL segment of another country (ISO2 lowercase; GB is 'uk'). */
export type Country = string;

export interface IndexEntry {
  /** Path, no trailing slash ("/" for home). */
  path: string;
  country: Country;
  type: PageType;
  section: Section;
  /** YYYY-MM-DD from real content or data dates; null = no <lastmod> (never a build time). */
  lastmod: string | null;
  title: string;
  /** One plain sentence for llms.txt; no numbers that are not on the page itself. */
  summary: string;
  state?: 'FL' | 'CA';
  /** Cities: the default utility's display name and (when it has one) its page path. */
  utility?: { name: string; path: string | null };
  /** Utilities: where this page's rates come from (database source_url + verified_on). */
  sources?: { url: string; checkedOn: string | null }[];
  /** Display name (city or utility), for grouping in llms.txt. */
  name?: string;
  /** Non-US place pages (type 'places'): the region name, for grouping in llms.txt, and whether this is a hub or a place. */
  region?: string;
  placeKind?: 'place' | 'hub';
}

/** noindex utility pages (confirmations, privacy request form). */
export const NOINDEX_UTILITY_PAGES: ReadonlySet<string> = new Set(['/alerts/thanks', '/quotes/thank-you', '/quotes/thanks', '/privacy/request', '/privacy/request/thanks']);

export interface ExclusionContext {
  /** Paths that 301 elsewhere (article routes, legacy US paths). */
  redirected?: ReadonlySet<string>;
  /** noindex / draft guide and blog paths, plus an index page while nothing is published. */
  excludedCollections?: ReadonlySet<string>;
}

const normalize = (p: string): string => p.replace(/\/+$/, '') || '/';

/** True when a prerendered or file route must stay out of the sitemap and llms files (the filter that used to live in astro.config.mjs). */
export function isExcludedStaticPath(rawPath: string, ctx: ExclusionContext = {}): boolean {
  const path = normalize(rawPath);
  return (
    !!ctx.redirected?.has(path) ||
    !!ctx.excludedCollections?.has(path) ||
    UNREVIEWED_PAGES.has(path) ||
    NOINDEX_UTILITY_PAGES.has(path) ||
    path === '/404' ||
    path.startsWith('/api/') ||
    path.startsWith('/admin') ||
    path.startsWith('/go/out/') ||
    isGoPath(path) ||
    path === '/unsubscribe'
  );
}

const utilityPaths: ReadonlySet<string> = new Set(UTILITY_PAGES.map(utilityPagePath));
const CALC_RE = /^\/us\/solar-payback\/(florida|california)$/;
const CITY_RE = /^\/us\/solar-payback\/(florida|california)\/[a-z0-9-]+$/;
/** Non-US article and article-index paths: /<cc>/guides, /<cc>/blog/<slug>, ... (cc is a URL segment, never 'us'). */
const INTL_ARTICLE_RE = /^\/(?!us\/)([a-z]{2})\/(guides|blog)(\/[a-z0-9-]+)?$/;

/** Which sitemap type a path belongs to. */
export function pageTypeOf(rawPath: string): PageType {
  const path = normalize(rawPath);
  if (CALC_RE.test(path)) return 'calculators';
  if (utilityPaths.has(path)) return 'utilities';
  if (CITY_RE.test(path)) return 'cities';
  if (INTL_ARTICLE_RE.test(path)) return 'articles';
  if (PLACE_PATH_RE.test(path)) return 'places';
  if (path === taxPath() || path.startsWith(`${taxPath()}/`)) return 'articles';
  return 'pages';
}

export const countryOf = (rawPath: string): Country => {
  const path = normalize(rawPath);
  const intl = INTL_ARTICLE_RE.exec(path);
  if (intl) return intl[1]!;
  const place = PLACE_PATH_RE.exec(path);
  if (place) return place[1]!;
  return path === US_BASE || path.startsWith(`${US_BASE}/`) ? 'us' : 'global';
};

/** sitemap file name for a (country, type) pair. */
export const sitemapFileName = (country: Country, type: PageType): string => `sitemap-${country}-${type}.xml`;
export const SITEMAP_FILE_RE = /^sitemap-(us|global|[a-z]{2})-(pages|calculators|utilities|cities|articles|places)\.xml$/;

export const absoluteUrl = (path: string, origin = SITE_ORIGIN): string => `${origin}${path}`;

/** Curated entries for the static, indexable pages that are not content-collection articles. */
export const STATIC_INDEX: Readonly<Record<string, { title: string; summary: string; section: Section }>> = {
  '/': { title: 'RayValue', summary: PAGE_META.home.description, section: 'home' },
  '/quotes': { title: PAGE_META.quotes.title, summary: PAGE_META.quotes.description, section: 'about' },
  '/methodology': { title: PAGE_META.methodology.title, summary: PAGE_META.methodology.description, section: 'about' },
  '/stories': { title: PAGE_META.stories.title, summary: PAGE_META.stories.description, section: 'about' },
  '/contact': { title: 'Contact RayValue', summary: 'Email RayValue about a solar or battery payback estimate, or use the privacy form to see or delete your data.', section: 'about' },
  '/guides': { title: PAGE_META.guides.title, summary: PAGE_META.guides.description, section: 'guides' },
  '/blog': { title: PAGE_META.blog.title, summary: PAGE_META.blog.description, section: 'blog' },
};

/** Per-country (non-US) article index page, e.g. /uk/guides. */
export const intlIndexPath = (collection: 'guides' | 'blog', segment: string): string => `/${segment}/${collection}`;

/** Static index pages that are listed only while their collection has published (non-draft, indexable) entries. */
export const COLLECTION_INDEX_PATHS: Readonly<Record<string, 'guides' | 'blog'>> = { '/guides': 'guides', '/blog': 'blog' };

/** Calculator pages (on demand, DB-backed). */
export const CALCULATOR_PAGES = [
  { state: 'FL' as const, path: '/us/solar-payback/florida', meta: PAGE_META['calculator-florida'] },
  { state: 'CA' as const, path: '/us/solar-payback/california', meta: PAGE_META['calculator-california'] },
];

/** Map a file under src/pages to its URL path, or null for dynamic routes and non-page files. */
export function pathFromPageFile(file: string): string | null {
  const rel = file.replace(/\\/g, '/').replace(/^.*?src\/pages\//, '');
  if (!/\.astro$/.test(rel) || /\[/.test(rel)) return null;
  const p = '/' + rel.replace(/\.astro$/, '').replace(/(^|\/)index$/, '');
  return normalize(p);
}

/** Entries grouped by sitemap file name, non-empty files only, URLs sorted; files sorted by name. */
export function groupBySitemap(entries: readonly IndexEntry[]): Map<string, IndexEntry[]> {
  const out = new Map<string, IndexEntry[]>();
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    const f = sitemapFileName(e.country, e.type);
    const list = out.get(f) ?? [];
    list.push(e);
    out.set(f, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.path.localeCompare(b.path));
  return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
