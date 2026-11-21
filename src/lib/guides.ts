/** Published (non-draft) US guides, for nav links and the /guides index. Astro-only (astro:content). */
import { getCollection } from 'astro:content';

export const publishedGuides = () => getCollection('guides', (g) => !g.data.draft && g.data.country === 'us');
/** Published (non-draft) guides of one non-US country (ISO2 lowercase), for /<cc>/guides. */
export const publishedGuidesFor = (cc: string) => getCollection('guides', (g) => !g.data.draft && g.data.country === cc);
/** Every non-draft non-US guide (static path generation). */
export const publishedIntlGuides = () => getCollection('guides', (g) => !g.data.draft && g.data.country !== 'us');
