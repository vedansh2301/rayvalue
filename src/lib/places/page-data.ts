/**
 * Everything a place or hub route needs from the database, resolved through the pure gate. SERVER-ONLY (reads PostgREST).
 * Result: 'ok' with a PlaceRoute (which may itself be not_found), or 'unavailable' when the database failed (the route
 * then answers 503, never a 404 that would tell crawlers the page is gone).
 */
import { isRegionPage, placeCountryForRoute, placePath, regionHubPath } from './config.ts';
import { evaluatePlace, hubRenders } from './gate.ts';
import { loadPlaceRegions, loadPublishedPlaces, type PlacesRepoDeps } from './repo.ts';
import { resolvePlaceRoute, type PlaceRoute, type RouteParams } from './resolve.ts';

export interface PlaceRouteData {
  status: 'ok';
  route: PlaceRoute;
  /** Other renderable places in the same region (place routes only). */
  others: { name: string; href: string }[];
  /** Region hub link, when that hub exists. */
  hubHref: string | null;
}
export type PlaceRouteResult = PlaceRouteData | { status: 'unavailable' };

export async function loadPlaceRoute(params: RouteParams, deps: PlacesRepoDeps = {}): Promise<PlaceRouteResult> {
  const country = placeCountryForRoute(params.cc, params.topic);
  if (!country) return { status: 'ok', route: { kind: 'not_found', country: null }, others: [], hubHref: null };

  const regions = await loadPlaceRegions(country.code, deps);
  if (!regions.ok) return { status: 'unavailable' };
  const region = regions.value.find((r) => r.slug === params.region);
  if (!region) return { status: 'ok', route: { kind: 'not_found', country }, others: [], hubHref: null };

  const places = await loadPublishedPlaces({ country: country.code, regionCode: region.code }, deps);
  if (!places.ok) {
    // Tables not migrated yet: nothing is published, so every place URL is simply not found.
    if (places.error.kind === 'http' && /HTTP 404\b/.test(places.error.message)) return { status: 'ok', route: { kind: 'not_found', country }, others: [], hubHref: null };
    return { status: 'unavailable' };
  }

  const route = resolvePlaceRoute(params, { regions: regions.value, places: places.value });
  const renderable = places.value.filter((p) => evaluatePlace(country.code, p).renders);
  const here = params.city ?? (country.countyPages ? region.slug : undefined);
  const others = renderable
    .filter((p) => p.slug !== here)
    .sort((a, b) => a.name.localeCompare(b.name, country.locale))
    .map((p) => ({ name: p.name, href: placePath(country, region.slug, p.slug) }));
  // The region link is the hub list, or the county's own page where there is one (never a link to the page itself).
  const regionPageRenders = renderable.some((p) => isRegionPage(country, region.slug, p.slug));
  const onRegionPage = route.kind === 'place' && route.view.isRegionPage;
  const hubHref = !onRegionPage && (regionPageRenders || hubRenders(renderable.length)) ? regionHubPath(country, region.slug) : null;
  return { status: 'ok', route, others, hubHref };
}
