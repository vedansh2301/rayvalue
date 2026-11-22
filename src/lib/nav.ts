/**
 * Header navigation. Guides and Blog are hidden from the header until each collection has at least
 * NAV_MIN_PUBLISHED published (non-draft) items, so the nav never leads to a near-empty section.
 * The routes stay live (and noindex while empty, see the index pages) and the footer still links them.
 */
import { calcPath } from './paths';

export const NAV_MIN_PUBLISHED = 3;

export interface NavLink {
  href: string;
  label: string;
  short: string;
}

const ALWAYS: NavLink[] = [
  { href: calcPath('FL'), label: 'Florida calculator', short: 'Florida' },
  { href: calcPath('CA'), label: 'California calculator', short: 'California' },
];

export function showInNav(publishedCount: number, min: number = NAV_MIN_PUBLISHED): boolean {
  return publishedCount >= min;
}

/** Path prefixes of the US-only pages: they keep the US header and footer (state calculators, "Get quotes"). */
const US_PREFIXES = ['/us', '/quotes', '/stories', '/guides', '/blog', '/alerts', '/go'] as const;

/**
 * True for pages that belong to no one country (/, /about, /methodology, /contact, legal pages, 404). They get the
 * global header and footer. Country pages (/uk, /de, ...) are handled by the country nav before this is consulted.
 */
export function isGlobalPath(path: string): boolean {
  const p = path.replace(/\/+$/, '') || '/';
  return !US_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`));
}

/** Global header: anchors on the home page, no US-only "Get quotes". */
export const GLOBAL_HEADER_LINKS: readonly NavLink[] = [
  { href: '/#countries', label: 'Countries', short: 'Countries' },
  { href: '/#calculators', label: 'Calculators', short: 'Calculators' },
  { href: '/#guides', label: 'Guides', short: 'Guides' },
  { href: '/methodology', label: 'Methodology', short: 'Method' },
];

export function headerLinks(counts: { guides: number; blog: number }, min: number = NAV_MIN_PUBLISHED): NavLink[] {
  return [
    ...ALWAYS,
    ...(showInNav(counts.guides, min) ? [{ href: '/guides', label: 'Guides', short: 'Guides' }] : []),
    ...(showInNav(counts.blog, min) ? [{ href: '/blog', label: 'Blog', short: 'Blog' }] : []),
  ];
}
