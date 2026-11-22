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
  // UK calculator: reachable from the /uk hub, guides and place pages, but out of the sitemap (and noindex while markets.published is
  // false) until the owner has reviewed the GB data and flips the market live.
  '/uk/solar-calculator',
  // German and Australian calculators (same rule): hidden until the owner reviews the DE / AU data and flips the market live.
  '/de/photovoltaik-rechner',
  '/au/solar-battery-calculator',
]);
