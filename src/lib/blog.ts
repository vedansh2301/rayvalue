/** Published (non-draft) blog posts, newest first, for the /blog index and OG images. Astro-only (astro:content). */
import { getCollection } from 'astro:content';

export const publishedPosts = async () =>
  (await getCollection('blog', (p) => !p.data.draft)).sort((a, b) => b.data.published.getTime() - a.data.published.getTime());
