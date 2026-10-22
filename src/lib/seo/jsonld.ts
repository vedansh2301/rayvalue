export const SITE_URL = 'https://rayvalue.com';
export const SITE_NAME = 'RayValue';

export type State = 'FL' | 'CA';
export type Crumb = { label: string; href?: string };

/** Absolute URL for a site path. Trailing slash policy: never (except root). */
export function absoluteUrl(path: string, site: string = SITE_URL): string {
  const base = site.replace(/\/+$/, '');
  if (path === '' || path === '/') return `${base}/`;
  return `${base}/${path.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

export function organizationJsonLd(site: string = SITE_URL) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: absoluteUrl('/', site),
    logo: absoluteUrl('/favicon.svg', site),
  };
}

export function breadcrumbJsonLd(items: Crumb[], site: string = SITE_URL) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.label,
      ...(item.href ? { item: absoluteUrl(item.href, site) } : {}),
    })),
  };
}

export function articleJsonLd(
  a: { headline: string; description: string; path: string; updated: Date; image?: string },
  site: string = SITE_URL,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.headline,
    description: a.description,
    dateModified: a.updated.toISOString().slice(0, 10),
    mainEntityOfPage: absoluteUrl(a.path, site),
    ...(a.image ? { image: a.image } : {}),
    author: { '@type': 'Organization', name: SITE_NAME, url: absoluteUrl('/', site) },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: absoluteUrl('/', site) },
  };
}

export const CALCULATOR_PATH: Record<State, string> = {
  FL: '/calculator/florida',
  CA: '/calculator/california',
};
const STATE_NAME: Record<State, string> = { FL: 'Florida', CA: 'California' };

export function webApplicationJsonLd(state: State, site: string = SITE_URL) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: `${STATE_NAME[state]} Solar + Battery Payback Calculator`,
    url: absoluteUrl(CALCULATOR_PATH[state], site),
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Any',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: absoluteUrl('/', site) },
  };
}

/** Calculators a guide should link to, from its frontmatter `state`. */
export function calculatorsForState(state: State | 'both'): { state: State; label: string; href: string }[] {
  const states: State[] = state === 'both' ? ['FL', 'CA'] : [state];
  return states.map((s) => ({ state: s, label: `${STATE_NAME[s]} calculator`, href: CALCULATOR_PATH[s] }));
}
