/** Published (non-draft) US blog posts, newest first, for the /blog index and OG images. Astro-only (astro:content). */
import { getCollection } from 'astro:content';

const newest = <T extends { data: { published: Date } }>(l: T[]) => l.sort((a, b) => b.data.published.getTime() - a.data.published.getTime());

export const publishedPosts = async () => newest(await getCollection('blog', (p) => !p.data.draft && p.data.country === 'us'));
/** Published posts of one non-US country (ISO2 lowercase), newest first. */
export const publishedPostsFor = async (cc: string) => newest(await getCollection('blog', (p) => !p.data.draft && p.data.country === cc));
/** Every non-draft non-US post (static path generation). */
export const publishedIntlPosts = () => getCollection('blog', (p) => !p.data.draft && p.data.country !== 'us');
