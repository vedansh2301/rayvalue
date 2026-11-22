/** Astro-only loader for per-country article counts (content collections), cached per module instance. */
import { getCollection } from 'astro:content';
import { countrySegment } from './content/paths';

export interface CountryCounts { guides: number; blog: number; lang: string }
let cache: Promise<Map<string, CountryCounts>> | null = null;

/** Segment -> published (non-draft, indexable) guide / blog counts, for every non-US country with any content. */
export function loadCountryCounts(): Promise<Map<string, CountryCounts>> {
  cache ??= (async () => {
    const [guides, blog] = await Promise.all([
      getCollection('guides', (g) => !g.data.draft && g.data.country !== 'us'),
      getCollection('blog', (p) => !p.data.draft && p.data.country !== 'us'),
    ]);
    const out = new Map<string, CountryCounts>();
    const bump = (e: { data: { country: string; lang: string; noindex?: boolean } }, k: 'guides' | 'blog') => {
      if (e.data.noindex) return;
      const seg = countrySegment(e.data.country);
      const c = out.get(seg) ?? { guides: 0, blog: 0, lang: e.data.lang };
      c[k] += 1;
      out.set(seg, c);
    };
    guides.forEach((g) => bump(g, 'guides'));
    blog.forEach((p) => bump(p, 'blog'));
    return out;
  })();
  return cache;
}
