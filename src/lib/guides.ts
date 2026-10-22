/** Published (non-draft) guides, for nav links and the /guides index. Astro-only (astro:content). */
import { getCollection } from 'astro:content';

export const publishedGuides = () => getCollection('guides', (g) => !g.data.draft);
