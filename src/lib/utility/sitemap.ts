/**
 * Build-time list of INDEXABLE utility page URLs for the sitemap. Utility pages render on demand, so the sitemap
 * cannot discover them; a page is listed only when its worked-examples table has real results (the same rule that
 * decides noindex on the page). Any failure returns [] so a build never fails.
 */
import { UTILITY_PAGES, utilityPagePath, type UtilityPageMeta } from './pages.ts';
import type { UtilityPageData } from './load.ts';

/** The utility pages that are indexable right now (the predicate the sitemap uses). Any failure skips that page. */
export async function getIndexableUtilityPages(load?: (slug: string) => Promise<UtilityPageData>): Promise<UtilityPageMeta[]> {
  const out: UtilityPageMeta[] = [];
  try {
    const loader = load ?? (await import('./load.ts')).loadUtilityPageData;
    for (const p of UTILITY_PAGES) {
      try {
        const d = await loader(p.slug);
        if (d.kind === 'ok' && d.vm.indexable) out.push(p);
      } catch {
        /* skip this page */
      }
    }
  } catch {
    return [];
  }
  return out;
}

let cached: Promise<UtilityPageMeta[]> | null = null;
/** Same list, loaded once per build (blog and guide pages share it). */
export const indexableUtilityPagesOnce = (): Promise<UtilityPageMeta[]> => (cached ??= getIndexableUtilityPages());

export async function getIndexableUtilityUrls(
  site = 'https://rayvalue.com',
  load?: (slug: string) => Promise<UtilityPageData>,
): Promise<string[]> {
  const base = site.replace(/\/+$/, '');
  return (await getIndexableUtilityPages(load)).map((p) => `${base}${utilityPagePath(p)}`);
}
