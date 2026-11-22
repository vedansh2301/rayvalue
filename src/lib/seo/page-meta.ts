/**
 * Titles and meta descriptions for static pages, kept as constants so a test can check their lengths.
 * `title` is WITHOUT the " | RayValue" suffix BaseLayout adds (except the home page, which is used as is).
 * Full title 50-60 characters; description 140-160.
 */
export const PAGE_META = {
  home: {
    title: 'Solar & Battery Payback Calculators by Country | RayValue',
    description: 'Use free solar and battery payback calculators to estimate installation costs and electricity bill savings. Explore local rates, export credits and grants.',
  },
  us: {
    title: 'Florida & California Solar and Battery Calculator',
    description: 'Estimate solar costs, bill savings and battery payback using Florida or California utility rates. Check installer quote availability in your ZIP code.',
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
    title: 'Free Solar Quotes in Florida and California',
    description: 'Check your Florida or California ZIP code for local solar installers. Request free quotes where available, with no obligation to buy or choose a contractor.',
  },
  stories: {
    title: 'Real solar and battery stories from FL and CA',
    description: 'Publicly reported stories of Florida and California homeowners and communities using solar and batteries, with what each one means for your own decision.',
  },
  'calculator-florida': {
    title: 'Florida solar and battery payback calculator',
    description: 'Estimate solar installation cost, electricity bill savings and battery payback in Florida using FPL, Duke Energy Florida or Tampa Electric rates and your bill.',
  },
  'calculator-california': {
    title: 'California solar and battery payback calculator',
    description: 'Compare solar with and without storage in California. Estimate installation cost, electricity bill savings and payback on PG&E, SCE or SDG&E using your bill.',
  },
} as const satisfies Record<string, { title: string; description: string }>;

export type PageMetaKey = keyof typeof PAGE_META;

/** The <title> BaseLayout renders for a page. */
export const fullTitle = (title: string, isHome = false): string => (isHome ? title : `${title} | RayValue`);
