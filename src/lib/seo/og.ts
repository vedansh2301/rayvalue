/** Distinct 1200x630 share cards for the key pages (rendered by src/pages/og/[...slug].png.ts). */
export interface OgCard {
  kicker: string;
  title: string;
  subtitle: string;
}

export const OG_PAGES = {
  home: { kicker: 'RayValue', title: 'Does solar still pay off without the federal tax credit?', subtitle: 'Honest payback ranges for Florida and California homes' },
  'calculator-florida': { kicker: 'Florida calculator', title: 'Florida solar + battery payback calculator', subtitle: 'Low, likely and high ranges from your utility’s own rates' },
  'calculator-california': { kicker: 'California calculator', title: 'California solar + battery payback calculator', subtitle: 'Low, likely and high ranges from your utility’s own rates' },
  quotes: { kicker: 'Free quotes', title: 'Compare solar quotes from up to 3 local installers', subtitle: 'No obligation. Florida and California.' },
  methodology: { kicker: 'Methodology', title: 'How RayValue estimates solar payback', subtitle: 'Every rate and assumption, with its source' },
} as const satisfies Record<string, OgCard>;

export type OgPageKey = keyof typeof OG_PAGES;

export const ogImagePath = (key: OgPageKey): string => `/og/${key}.png`;
