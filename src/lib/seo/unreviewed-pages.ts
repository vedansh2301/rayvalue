/**
 * Static pages whose copy the owner has not written or reviewed yet. They stay reachable (footer
 * links) but are noindex and out of the sitemap. Remove a path here once the owner signs it off.
 */
export const UNREVIEWED_PAGES: ReadonlySet<string> = new Set([
  '/about',
  '/terms',
  '/affiliate-disclosure',
  '/privacy',
  '/credits',
  // German and Australian calculators: hidden until the owner reviews the DE / AU data and flips the market live.
  '/de/photovoltaik-rechner',
  '/au/solar-battery-calculator',
]);
