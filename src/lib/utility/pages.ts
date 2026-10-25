/**
 * Utility pages: /solar/<state>/<utility>. This is routing and copy metadata only (slugs, display names, titles);
 * every rate, cost and assumption shown on the page comes from the database (see view.ts).
 * Static routes win over /solar/[state]/[city], so these slugs are reserved: no city may use one.
 */
import type { Utility } from '../../data/schemas';

export interface UtilityPageMeta {
  slug: string;
  utilityId: Utility['id'];
  state: 'FL' | 'CA';
  /** Short name used in headings and sentences. */
  short: string;
  /** Page title WITHOUT the " | RayValue" suffix BaseLayout adds. Full title must be 50-60 characters. */
  title: string;
  /** Meta description, 150-160 characters. */
  description: string;
}

export const UTILITY_PAGES: readonly UtilityPageMeta[] = [
  {
    slug: 'fpl', utilityId: 'fpl', state: 'FL', short: 'FPL',
    title: 'Solar payback with FPL in 2026: no tax credit',
    description: 'How rooftop solar and a battery pay back on FPL rates in 2026 with no federal tax credit: rate rules, net metering and worked examples for three bill sizes.',
  },
  {
    slug: 'duke-energy-florida', utilityId: 'duke-fl', state: 'FL', short: 'Duke Energy Florida',
    title: 'Duke Energy Florida solar payback in 2026',
    description: 'How rooftop solar and a battery pay back on Duke Energy Florida rates in 2026 with no federal tax credit: rate rules, net metering and worked examples.',
  },
  {
    slug: 'teco', utilityId: 'teco', state: 'FL', short: 'TECO',
    title: 'Solar payback with TECO in 2026: no tax credit',
    description: 'How rooftop solar and a battery pay back on Tampa Electric (TECO) rates in 2026 with no federal tax credit: rate rules, net metering and worked examples.',
  },
  {
    slug: 'pge', utilityId: 'pge', state: 'CA', short: 'PG&E',
    title: 'Solar payback with PG&E in 2026: no tax credit',
    description: 'How rooftop solar and a battery pay back on PG&E rates in 2026 with no federal tax credit: time-of-use rates, NEM 3.0 export credits and worked examples.',
  },
  {
    slug: 'sce', utilityId: 'sce', state: 'CA', short: 'SCE',
    title: 'Solar payback with SCE in 2026: no tax credit',
    description: 'How rooftop solar and a battery pay back on SCE rates in 2026 with no federal tax credit: time-of-use rates, NEM 3.0 export credits and worked examples.',
  },
  {
    slug: 'sdge', utilityId: 'sdge', state: 'CA', short: 'SDG&E',
    title: 'Solar payback with SDG&E in 2026: no tax credit',
    description: 'How rooftop solar and a battery pay back on SDG&E rates in 2026 with no federal tax credit: time-of-use rates, NEM 3.0 export credits and worked examples.',
  },
];

export const STATE_SLUG = { FL: 'florida', CA: 'california' } as const;

/** Slugs a city page must never use (the static utility route would shadow it). */
export const RESERVED_CITY_SLUGS: ReadonlySet<string> = new Set(UTILITY_PAGES.map((p) => p.slug));

export const utilityPageByPath = (state: 'FL' | 'CA', slug: string): UtilityPageMeta | null =>
  UTILITY_PAGES.find((p) => p.state === state && p.slug === slug) ?? null;

export const utilityPagePath = (p: UtilityPageMeta): string => `/solar/${STATE_SLUG[p.state]}/${p.slug}`;
export const utilityPagesForState = (state: 'FL' | 'CA'): UtilityPageMeta[] => UTILITY_PAGES.filter((p) => p.state === state);
