import { defineCollection, type SchemaContext } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/** Optional real cover photo for cards and the article header; alt text is required whenever a cover is set. */
const coverFields = (image: SchemaContext['image']) => ({
  cover: image().optional(),
  coverAlt: z.string().min(1).optional(),
});
const needsAlt = (d: { cover?: unknown; coverAlt?: string }) => !d.cover || !!d.coverAlt;
const altMessage = { message: 'coverAlt is required when cover is set', path: ['coverAlt'] };

const guides = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/guides' }),
  schema: ({ image }) => z.object({
    title: z.string(),
    description: z.string(),
    /** Optional <title> (without the " | RayValue" suffix); keeps the full title at 50-60 characters. */
    seoTitle: z.string().optional(),
    /** First-publish date (from git history). Never backdated. */
    published: z.coerce.date().optional(),
    updated: z.coerce.date(),
    state: z.enum(['FL', 'CA', 'both']),
    sources: z.array(z.object({ title: z.string(), url: z.string().url() })).min(1),
    /** Optional cover-graphic topic for the index cards; derived from tags/title when omitted. */
    topic: z.enum(['map', 'battery', 'bill', 'house', 'sun', 'scale', 'chart']).optional(),
    draft: z.boolean().optional(),
    /** Owner-facing notes (unverified items, missing sources). Never rendered. */
    todo: z.array(z.string()).optional(),
    /** Default true: guides are not indexed (noindex + not in sitemap) until the owner sets false. */
    noindex: z.boolean().default(true),
    ...coverFields(image),
  }).refine(needsAlt, altMessage),
});

const blog = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/blog' }),
  schema: ({ image }) => z.object({
    title: z.string(),
    description: z.string(),
    seoTitle: z.string().optional(),
    published: z.coerce.date(),
    updated: z.coerce.date().optional(),
    state: z.enum(['FL', 'CA', 'both']).optional(),
    tags: z.array(z.string()).default([]),
    /** Any number or factual claim in a post must be backed by a source listed here (CLAUDE.md rule 1). */
    sources: z.array(z.object({ title: z.string(), url: z.string().url() })).default([]),
    topic: z.enum(['map', 'battery', 'bill', 'house', 'sun', 'scale', 'chart']).optional(),
    draft: z.boolean().optional(),
    /** Default true: posts are not indexed (noindex + not in sitemap) until the owner sets false. */
    noindex: z.boolean().default(true),
    ...coverFields(image),
  }).refine(needsAlt, altMessage),
});

/**
 * Real stories: publicly reported, sourced accounts only. No testimonials, no invented people.
 * Every number in `summary` must appear in the cited source (CLAUDE.md rule 1).
 */
const stories = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/stories' }),
  schema: z.object({
    title: z.string(),
    state: z.enum(['FL', 'CA']),
    location: z.string(),
    date_reported: z.coerce.date(),
    summary: z.string(),
    lesson: z.string(),
    source: z.object({
      publisher: z.string(),
      title: z.string(),
      url: z.string().url(),
      published: z.coerce.date(),
    }),
    /** Only with a reusable license; otherwise omit. */
    photo: z.object({ src: z.string(), alt: z.string(), credit: z.string(), license: z.string() }).optional(),
  }),
});

export const collections = { guides, blog, stories };
