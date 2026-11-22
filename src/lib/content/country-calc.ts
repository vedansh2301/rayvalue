/**
 * Which non-US countries have their own calculator, and the CTA wording for it. Pure. The US calculators and the
 * US-only "Get quotes" lead CTA are handled elsewhere (src/components/seo/GuideCalculatorLinks.astro).
 */
export interface CountryCalculator {
  href: string;
  heading: string;
  body: string;
  cta: string;
}

const UK: CountryCalculator = {
  href: '/uk/solar-calculator',
  heading: 'See what solar would do for your home',
  body: 'Low, likely and high ranges for cost, savings and payback, using your regional price cap, your export payment and official installation costs.',
  cta: 'Run my UK numbers',
};

/** Calculator for a country, given its ISO2 code (any case) or URL segment ("gb" and "uk" are the same); null when none exists yet. */
export function countryCalculator(country: string | null | undefined): CountryCalculator | null {
  const c = (country ?? '').toLowerCase();
  return c === 'gb' || c === 'uk' ? UK : null;
}
