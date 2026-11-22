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

/** Non-US articles: ISO-3166 alpha-2, lowercase. Files live at src/content/<collection>/<cc>/<slug>.mdx and render at /<cc>/<collection>/<slug> (GB under /uk/). */
const countryFields = {
  country: z.string().regex(/^[a-z]{2}$/, 'country is ISO2 lowercase, e.g. "gb"').default('us'),
  /** BCP47 language tag for <html lang>. */
  lang: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'lang is BCP47, e.g. "en-GB"').default('en-US'),
};

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
    /** Last day of a dated deadline the article is about (the date is stated in the article and its sources); drives the home "days left" cards. */
    deadline: z.coerce.date().optional(),
    /** Required for US guides (country 'us'); optional for non-US. */
    state: z.enum(['FL', 'CA', 'both']).optional(),
    ...countryFields,
    sources: z.array(z.object({ title: z.string(), url: z.string().url() })).min(1),
    /** Optional cover-graphic topic for the index cards; derived from tags/title when omitted. */
    topic: z.enum(['map', 'battery', 'bill', 'house', 'sun', 'scale', 'chart']).optional(),
    draft: z.boolean().optional(),
    /** Owner-facing notes (unverified items, missing sources). Never rendered. */
    todo: z.array(z.string()).optional(),
    /** Optional keyword URL (e.g. /us/solar-tax-benefits/florida) instead of /guides/<id>; the old path 301-redirects to it. */
    route: z.string().regex(/^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/).optional(),
    /** Default true: guides are not indexed (noindex + not in sitemap) until the owner sets false. */
    noindex: z.boolean().default(true),
    /** Optional visible FAQ, rendered after the body; the same items feed the page's FAQPage JSON-LD. Plain text only. */
    faq: z.array(z.object({ question: z.string().min(1), answer: z.string().min(1) })).optional(),
    ...coverFields(image),
  }).refine(needsAlt, altMessage)
    .refine((d) => d.country !== 'us' || !!d.state, { message: 'state is required for US guides', path: ['state'] }),
});

const blog = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/blog' }),
  schema: ({ image }) => z.object({
    title: z.string(),
    description: z.string(),
    seoTitle: z.string().optional(),
    published: z.coerce.date(),
    updated: z.coerce.date().optional(),
    /** As on guides: last day of a dated deadline the post is about. */
    deadline: z.coerce.date().optional(),
    state: z.enum(['FL', 'CA', 'both']).optional(),
    ...countryFields,
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
  schema: ({ image }) => z.object({
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
    /** Optional card photo: public domain, CC0 or CC BY/BY-SA only, credited on /credits. Alt text is required with it. */
    image: image().optional(),
    imageAlt: z.string().min(1).optional(),
  }).refine((d) => !d.image || !!d.imageAlt, { message: 'imageAlt is required when image is set', path: ['imageAlt'] }),
});

export const collections = { guides, blog, stories };
