import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const guides = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/guides' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    updated: z.coerce.date(),
    state: z.enum(['FL', 'CA', 'both']),
    sources: z.array(z.object({ title: z.string(), url: z.string().url() })).min(1),
    draft: z.boolean().optional(),
    /** Default true: guides are not indexed (noindex + not in sitemap) until the owner sets false. */
    noindex: z.boolean().default(true),
  }),
});

export const collections = { guides };
