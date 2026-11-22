/**
 * Country-aware navigation, pure. Non-US pages (/uk, /de, /au, ...) get their own header and footer links instead of the
 * US calculators and the US-only "Get quotes" lead CTA (consent and buyers exist only for the US).
 */
import { articleIndexPath, countrySegment } from './paths.ts';
import { uiText } from '../i18n/ui.ts';

export const US_SEGMENT = 'us';
/** A country hub is indexable (and listed in the sitemap) only with at least this many published items. */
export const HUB_MIN_ITEMS = 3;

/**
 * The country segment of a path when it is one of the `known` content countries (so /go and /og, which are not
 * countries, never match). null for the US, for global pages and for unknown segments.
 */
export function countryFromPath(pathname: string, known: readonly string[]): string | null {
  const seg = pathname.split('/')[1]?.toLowerCase() ?? '';
  return seg !== US_SEGMENT && known.includes(seg) ? seg : null;
}

export const hubPath = (segment: string): string => `/${segment}`;

/** Published items on a country hub: indexable guides + blog posts + rendered place hubs. */
export const hubItemCount = (c: { guides: number; blog: number; placeHubs?: number }): number => c.guides + c.blog + (c.placeHubs ?? 0);
export const hubIndexable = (itemCount: number): boolean => itemCount >= HUB_MIN_ITEMS;

/** Display name of a country segment in the reader's language ("uk" is GB). */
export function countryName(segment: string, lang = 'en'): string {
  const code = (segment === 'uk' ? 'gb' : segment).toUpperCase();
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code; } catch { return code; }
}

export interface CountryNavInput {
  segment: string;
  lang?: string;
  /** Published (non-draft, indexable) entries of this country. */
  counts: { guides: number; blog: number };
  /** Segments of every country that has content, including this one. */
  countries: readonly string[];
}
export interface NavItem { href: string; label: string }
export interface CountryNav {
  segment: string;
  home: NavItem;
  /** Guides / Blog, each only when this country has published entries. */
  links: NavItem[];
  switcher: (NavItem & { current: boolean })[];
}

export function countryNav(i: CountryNavInput): CountryNav {
  const t = uiText(i.lang);
  const links: NavItem[] = [];
  if (i.counts.guides > 0) links.push({ href: articleIndexPath('guides', i.segment), label: t.guides });
  if (i.counts.blog > 0) links.push({ href: articleIndexPath('blog', i.segment), label: t.blog });
  const switcher = [...new Set(i.countries)].sort().map((s) => ({ href: hubPath(s), label: countryName(s, i.lang ?? 'en'), current: s === i.segment }));
  return { segment: i.segment, home: { href: hubPath(i.segment), label: t.home }, links, switcher };
}

/** Segments of the non-US countries that have at least one published article. */
export const contentCountries = (entries: readonly { data: { country: string } }[]): string[] =>
  [...new Set(entries.map((e) => e.data.country).filter((c) => c !== US_SEGMENT).map(countrySegment))].sort();
