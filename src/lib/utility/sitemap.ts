/**
 * Build-time list of INDEXABLE utility page URLs for the sitemap. Utility pages render on demand, so the sitemap
 * cannot discover them; a page is listed only when its worked-examples table has real results (the same rule that
 * decides noindex on the page). Any failure returns [] so a build never fails.
 */
import { UTILITY_PAGES, utilityPagePath } from './pages.ts';
import type { UtilityPageData } from './load.ts';

export async function getIndexableUtilityUrls(
  site = 'https://rayvalue.com',
  load?: (slug: string) => Promise<UtilityPageData>,
): Promise<string[]> {
  const out: string[] = [];
  try {
    const loader = load ?? (await import('./load.ts')).loadUtilityPageData;
    for (const p of UTILITY_PAGES) {
      try {
        const d = await loader(p.slug);
        if (d.kind === 'ok' && d.vm.indexable) out.push(`${site.replace(/\/+$/, '')}${utilityPagePath(p)}`);
      } catch {
        /* skip this page */
      }
    }
  } catch {
    return [];
  }
  return out;
}
