/**
 * Pure helpers for the blog/guides index cards: reading time from the article body and the cover topic
 * (explicit frontmatter `topic`, else derived from tags/title). No numbers are hand-typed per article.
 */
export const TOPICS = ['map', 'battery', 'bill', 'house', 'sun', 'scale', 'chart'] as const;
export type Topic = (typeof TOPICS)[number];

/** Typical adult silent-reading speed used for read-time estimates (words per minute). */
export const WORDS_PER_MINUTE = 200;

/** Words in an MDX body, ignoring import/export lines, JSX tags, code fences and markdown punctuation. */
export function wordCount(mdx: string): number {
  const text = mdx
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*(import|export)\s.*$/gm, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\]\([^)]*\)/g, ' ')
    .replace(/[#*_`>|\[\]-]+/g, ' ');
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

/** Whole minutes to read, at least 1. */
export function readMinutes(mdx: string | undefined): number {
  return Math.max(1, Math.round(wordCount(mdx ?? '') / WORDS_PER_MINUTE));
}

const KEYWORDS: readonly [Topic, RegExp][] = [
  ['battery', /battery|batteries|backup|storage/],
  ['bill', /bill|rate|price|cost|expensive|tariff|nem|net-metering|credit/],
  ['scale', /compare|lease|vs|worth|decid|quote/],
  ['house', /home|house|roof|value|renter|community|ev/],
  ['chart', /degrad|lifespan|production|payback|saving/],
];

/** Cover topic: explicit `topic` wins; otherwise the first keyword match over tags then title; else by state. */
export function coverTopic(a: { topic?: Topic; tags?: readonly string[]; title: string; state?: 'FL' | 'CA' | 'both' }): Topic {
  if (a.topic) return a.topic;
  for (const hay of [(a.tags ?? []).join(' ').toLowerCase(), a.title.toLowerCase()]) {
    for (const [topic, re] of KEYWORDS) if (re.test(hay)) return topic;
  }
  return a.state === 'FL' || a.state === 'CA' ? 'map' : 'sun';
}

export type StateKey = 'FL' | 'CA' | 'both';
export const stateKey = (s: StateKey | undefined): StateKey => s ?? 'both';
