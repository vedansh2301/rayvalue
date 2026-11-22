/**
 * Editorial order of the biggest / most important places per country (URL segment -> place slugs), used by the footer
 * so it links Munich and Cologne rather than the first five names alphabetically. Slugs only: a slug that is not a
 * published place is skipped, and countries not listed (or short lists) fall back to alphabetical order.
 */
export const PLACE_PRIORITY: Readonly<Record<string, readonly string[]>> = {
  uk: ['edinburgh', 'manchester', 'birmingham', 'glasgow', 'leeds', 'liverpool', 'bristol', 'cardiff', 'belfast', 'sheffield'],
  de: ['berlin', 'hamburg', 'muenchen', 'koeln', 'frankfurt-am-main', 'stuttgart', 'duesseldorf', 'dortmund', 'essen', 'leipzig'],
  au: ['sydney', 'melbourne', 'brisbane', 'perth', 'adelaide', 'canberra', 'gold-coast', 'newcastle', 'hobart', 'darwin'],
  es: ['madrid', 'barcelona', 'valencia', 'sevilla', 'zaragoza', 'malaga', 'bilbao', 'alicante', 'murcia', 'palma'],
  fr: ['paris', 'marseille', 'lyon', 'toulouse', 'nice', 'nantes', 'bordeaux', 'lille', 'strasbourg', 'montpellier'],
  nl: ['amsterdam', 'rotterdam', 'den-haag', 'utrecht', 'eindhoven', 'groningen', 'tilburg', 'almere', 'breda', 'nijmegen'],
  ie: ['dublin', 'cork', 'galway', 'limerick', 'waterford', 'kerry', 'donegal', 'kildare', 'meath', 'wexford'],
  ch: ['zuerich', 'bern', 'basel', 'luzern', 'st-gallen', 'winterthur', 'zug', 'thun', 'biel', 'chur'],
  it: ['roma', 'milano', 'napoli', 'torino', 'palermo', 'genova', 'bologna', 'firenze', 'bari', 'catania'],
  se: ['stockholm', 'goeteborg', 'malmoe', 'uppsala', 'vaesteraas'],
  dk: ['koebenhavn', 'aarhus', 'odense', 'aalborg'],
  no: ['oslo', 'bergen', 'trondheim', 'stavanger'],
  fi: ['helsinki', 'espoo', 'tampere', 'vantaa', 'oulu'],
  pl: ['warszawa', 'krakow', 'lodz', 'wroclaw', 'poznan'],
  cz: ['praha', 'brno', 'ostrava', 'plzen'],
  ro: ['bucuresti', 'cluj-napoca', 'timisoara', 'iasi', 'constanta'],
};

/** Orders place entries (a path ending in the slug, plus a name): priority slugs first, the rest by name. */
export function byPriority<T extends { path: string; name?: string | null }>(segment: string, items: readonly T[]): T[] {
  const order = PLACE_PRIORITY[segment] ?? [];
  const rank = (e: T): number => {
    const i = order.indexOf(e.path.split('/').pop() ?? '');
    return i < 0 ? order.length : i;
  };
  return [...items].sort((a, b) => rank(a) - rank(b) || (a.name ?? '').localeCompare(b.name ?? ''));
}
