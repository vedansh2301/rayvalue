/**
 * Header navigation. Guides and Blog are hidden from the header until each collection has at least
 * NAV_MIN_PUBLISHED published (non-draft) items, so the nav never leads to a near-empty section.
 * The routes stay live (and noindex while empty, see the index pages) and the footer still links them.
 */
export const NAV_MIN_PUBLISHED = 3;

export interface NavLink {
  href: string;
  label: string;
  short: string;
}

const ALWAYS: NavLink[] = [
  { href: '/calculator/florida', label: 'Florida calculator', short: 'Florida' },
  { href: '/calculator/california', label: 'California calculator', short: 'California' },
];

export function showInNav(publishedCount: number, min: number = NAV_MIN_PUBLISHED): boolean {
  return publishedCount >= min;
}

export function headerLinks(counts: { guides: number; blog: number }, min: number = NAV_MIN_PUBLISHED): NavLink[] {
  return [
    ...ALWAYS,
    ...(showInNav(counts.guides, min) ? [{ href: '/guides', label: 'Guides', short: 'Guides' }] : []),
    ...(showInNav(counts.blog, min) ? [{ href: '/blog', label: 'Blog', short: 'Blog' }] : []),
  ];
}
