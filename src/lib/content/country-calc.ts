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

const DE: CountryCalculator = {
  href: '/de/photovoltaik-rechner',
  heading: 'Was bringt Photovoltaik auf Ihrem Dach?',
  body: 'Niedrige, wahrscheinliche und hohe Spannen für Kosten, Ersparnis und Amortisation, aus Strompreis, EEG-Vergütung und echten Angebotspreisen.',
  cta: 'Meine Zahlen berechnen',
};

const AU: CountryCalculator = {
  href: '/au/solar-battery-calculator',
  heading: 'See what solar and a battery would do for your home',
  body: 'Low, likely and high ranges for cost, savings and payback, using your network’s regulated prices, your feed-in rate and the federal battery rebate.',
  cta: 'Run my Australian numbers',
};

/** Calculator for a country, given its ISO2 code (any case) or URL segment ("gb" and "uk" are the same); null when none exists yet. */
export function countryCalculator(country: string | null | undefined): CountryCalculator | null {
  const c = (country ?? '').toLowerCase();
  if (c === 'gb' || c === 'uk') return UK;
  if (c === 'de') return DE;
  if (c === 'au') return AU;
  return null;
}
