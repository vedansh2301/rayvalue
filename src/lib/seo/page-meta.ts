/**
 * Titles and meta descriptions for static pages, kept as constants so a test can check their lengths.
 * `title` is WITHOUT the " | RayValue" suffix BaseLayout adds (except the home page, which is used as is).
 * Full title 50-60 characters; description 140-160.
 */
export const PAGE_META = {
  home: {
    title: 'RayValue | Solar payback for Florida and California homes',
    description: 'Honest solar and battery payback estimates for Florida and California homeowners, as low, likely and high ranges, calculated without the federal tax credit.',
  },
  blog: {
    title: 'Solar and battery costs, rates and payback blog',
    description: 'Analysis of solar and battery costs, electricity rates and payback for Florida and California homeowners, with sources for every number we cite.',
  },
  guides: {
    title: 'Solar and battery payback guides for FL and CA',
    description: 'Plain-language guides on solar and battery payback for Florida and California homeowners: tax credit changes, NEM 3.0, quotes, leases and loans.',
  },
  methodology: {
    title: 'How we estimate solar payback: methodology',
    description: 'How RayValue estimates solar system size, installed cost, bill savings and payback, with every rate and assumption sourced, and why we show ranges.',
  },
  quotes: {
    title: 'Get free solar quotes from local installers',
    description: 'Request free, no-obligation solar quotes from up to 3 local installers in Florida or California. Takes about a minute, and you choose who contacts you.',
  },
  stories: {
    title: 'Real solar and battery stories from FL and CA',
    description: 'Publicly reported stories of Florida and California homeowners and communities using solar and batteries, with what each one means for your own decision.',
  },
  'calculator-florida': {
    title: 'Florida solar and battery payback calculator',
    description: 'Estimate solar and battery cost, savings and payback for your Florida home as low, likely and high ranges, using utility rates and no federal tax credit.',
  },
  'calculator-california': {
    title: 'California solar and battery payback calculator',
    description: 'Estimate solar and battery cost, savings and payback for your California home as low, likely and high ranges, using utility rates and no federal tax credit.',
  },
} as const satisfies Record<string, { title: string; description: string }>;

export type PageMetaKey = keyof typeof PAGE_META;

/** The <title> BaseLayout renders for a page. */
export const fullTitle = (title: string, isHome = false): string => (isHome ? title : `${title} | RayValue`);
