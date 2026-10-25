/**
 * Paid-traffic landing pages (/go/fl, /go/ca). Pure config so the routes, the noindex rule and the sitemap filter
 * share one list. These pages are noindex and never in the sitemap: they exist for ad clicks, not search.
 */
import type { State } from '../data/schemas';

export interface GoPage {
  state: State;
  path: string;
  stateName: string;
}

export const GO_PAGES: readonly GoPage[] = [
  { state: 'FL', path: '/go/fl', stateName: 'Florida' },
  { state: 'CA', path: '/go/ca', stateName: 'California' },
];

export const GO_PATHS: ReadonlySet<string> = new Set(GO_PAGES.map((g) => g.path));

/** FAQ ids shown on landing pages (see src/lib/content/faq.ts): short, and none promise an outcome. */
export const GO_FAQ_IDS = ['free', 'without-credit', 'contact', 'accuracy'] as const;

/** Trust strip text (same claims as the homepage strip). */
export const GO_TRUST = ['Free', 'No sign-up for the calculator', 'Every assumption shown', 'No federal tax credit assumed'] as const;

export const isGoPath = (path: string): boolean => GO_PATHS.has(path.replace(/\/+$/, '') || '/');
