/**
 * Links for the footer's "Solar by country and city" block. Pure: the footer passes the published place entries (already
 * gated: only indexable place pages are listed), the live guides and the US city/utility links. Nothing here invents a
 * URL: every href comes from one of those inputs or from the calculator and hub path helpers.
 */
import { articlePath, articleSlug } from './content/paths.ts';
import { countryCalculator } from './content/country-calc.ts';
import { countryName, US_SEGMENT } from './content/country-nav.ts';
import { calcPath } from './paths.ts';
import { PLACE_TEXT } from './places/i18n.ts';
import { placeCountryBySegment } from './places/config.ts';
import { byPriority } from './place-priority.ts';
import type { IndexEntry } from './seo/site-index.ts';

export interface FooterLink { href: string; label: string; lang?: string }
export interface FooterGroup { segment: string; name: string; links: FooterLink[] }

/** Editorial: each country's "is solar worth it" guide (collection guides). Existence and title are checked against the live guides. */
export const WORTH_GUIDES: readonly { country: string; slug: string }[] = [
  { country: 'us', slug: 'is-solar-worth-it-california-2026' },
  { country: 'gb', slug: 'are-solar-panels-worth-it-uk' },
  { country: 'au', slug: 'is-a-solar-battery-worth-it-australia' },
  { country: 'fr', slug: 'panneaux-solaires-rentables-ou-pas-2026' },
  { country: 'br', slug: 'energia-solar-vale-a-pena-2026' },
  { country: 'cl', slug: 'conviene-paneles-solares-chile-2026' },
  { country: 'co', slug: 'vale-la-pena-energia-solar-colombia' },
  { country: 'in', slug: 'is-rooftop-solar-worth-it-india' },
  { country: 'jm', slug: 'is-solar-worth-it-jamaica' },
];

export interface FooterGuide { id: string; route?: string; country: string; lang: string; title: string; draft?: boolean; noindex?: boolean }
export interface FooterInput {
  places: readonly IndexEntry[];
  guides: readonly FooterGuide[];
  usCities: readonly { href: string; name: string; state: string }[];
  usUtilities: readonly { href: string; label: string }[];
  /** Place links per country. */
  perCountry?: number;
}

const placeLabel = (e: IndexEntry): string => {
  const c = placeCountryBySegment(e.country);
  return c ? PLACE_TEXT[c.code].h1(e.name ?? '') : (e.name ?? e.title);
};

export function footerSeoGroups(i: FooterInput): FooterGroup[] {
  const per = i.perCountry ?? 5;
  const live = i.guides.filter((g) => !g.draft && !g.noindex);
  const segs = new Set<string>([US_SEGMENT]);
  for (const e of i.places) if (e.type === 'places' && e.placeKind === 'place') segs.add(e.country);
  for (const w of WORTH_GUIDES) segs.add(w.country === 'gb' ? 'uk' : w.country);
  const groups: FooterGroup[] = [];
  for (const segment of segs) {
    const links: FooterLink[] = [];
    const name = countryName(segment, 'en');
    if (segment === US_SEGMENT) {
      links.push({ href: calcPath('FL'), label: 'Florida solar calculator' }, { href: calcPath('CA'), label: 'California solar calculator' });
    } else {
      const calc = countryCalculator(segment);
      if (calc) links.push({ href: calc.href, label: `${name} solar calculator` });
    }
    const w = WORTH_GUIDES.find((x) => (x.country === 'gb' ? 'uk' : x.country) === segment);
    const g = w && live.find((a) => a.country.toLowerCase() === w.country && articleSlug(a.id, w.country) === w.slug);
    if (g) links.push({ href: articlePath('guides', g.id, g.route, g.country), label: g.title, lang: g.lang });
    if (segment === US_SEGMENT) {
      for (const c of i.usCities.slice(0, Math.min(per, 3))) links.push({ href: c.href, label: `Solar payback in ${c.name}, ${c.state}` });
      for (const u of i.usUtilities.slice(0, 4)) links.push({ href: u.href, label: `Solar with ${u.label}` });
    } else {
      const hl = placeCountryBySegment(segment)?.htmlLang;
      const lang = hl && !hl.startsWith('en') ? hl : undefined;
      const ps = byPriority(segment, i.places.filter((e) => e.country === segment && e.type === 'places' && e.placeKind === 'place'));
      for (const e of ps.slice(0, per)) links.push({ href: e.path, label: placeLabel(e), lang });
    }
    if (links.length > 0) groups.push({ segment, name, links });
  }
  return groups.sort((a, b) => (a.segment === US_SEGMENT ? -1 : b.segment === US_SEGMENT ? 1 : a.name.localeCompare(b.name)));
}
