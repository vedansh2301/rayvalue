/**
 * Titles and meta descriptions for static pages, kept as constants so a test can check their lengths.
 * `title` is WITHOUT the " | RayValue" suffix BaseLayout adds (except the home page, which is used as is).
 * Full title 50-60 characters; description 140-160.
 */
export const PAGE_META = {
  home: {
    title: 'RayValue | Solar payback by country, from official data',
    description: 'Independent solar and home-battery payback math from official tariffs, export rates and grants, country by country. Pick your country to start.',
  },
  us: {
    title: 'Solar payback for Florida and California homes',
    description: 'Honest solar and battery payback estimates for US homeowners in Florida and California, as low, likely and high ranges, with no federal tax credit.',
  },
  blog: {
    title: 'Solar and battery news and analysis, worldwide',
    description: 'Analysis of solar and battery costs, electricity rates, rebates and payback in every country we cover, with a source and a check date for each number.',
  },
  guides: {
    title: 'Solar and battery guides for every country',
    description: 'Plain-language guides on solar and home batteries from every country we cover: tariffs, rebates, tax rules, quotes and payback, each with its sources.',
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
