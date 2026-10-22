import { defineConfig } from 'astro/config';
import { readdirSync, readFileSync } from 'node:fs';
import mdx from '@astrojs/mdx';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { guideFlags, excludedGuideUrls } from './src/lib/seo/guide-flags.ts';
import { getPublishedCityUrls } from './src/lib/seo/sitemap-cities.ts';

// Server code reads secrets from process.env at request time (never import.meta.env, which Vite inlines
// into the function bundle). Under `astro dev`, load .env.local (from `vercel env pull`) into process.env.
if (process.argv.includes('dev')) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    /* no .env.local: DB pages show "being verified", /api/pvwatts returns 503 */
  }
}

const guideDir = './src/content/guides';
const excludedGuides = excludedGuideUrls(
  readdirSync(guideDir).filter((f) => f.endsWith('.mdx')).map((f) => ({ id: f.replace(/\.mdx$/, ''), ...guideFlags(readFileSync(`${guideDir}/${f}`, 'utf8')) })),
);

// Published city pages are on-demand, so list them for the sitemap from the DB at build time
// (offline / no env => [], build still succeeds). Unpublished cities are never listed.
const dbEnv = loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), '');
const cityUrls = await getPublishedCityUrls({
  url: process.env.SUPABASE_URL || dbEnv.SUPABASE_URL,
  key: process.env.SUPABASE_PUBLISHABLE_KEY || dbEnv.SUPABASE_PUBLISHABLE_KEY,
});

export default defineConfig({
  site: 'https://rayvalue.com',
  output: 'static',
  security: { csp: true },
  // Shiki emits inline styles, which the hashed CSP blocks; guides have no code blocks, so no highlighting.
  markdown: { syntaxHighlight: false },
  // Static pages stay prerendered. API routes and pages that read the Supabase calculator data
  // opt out (prerender = false) and run as Vercel Functions.
  adapter: vercel(),
  // Canonical policy: no trailing slash. @astrojs/vercel forces build.format 'directory'; Vercel serves /x from x/index.html.
  trailingSlash: 'never',
  build: { format: 'directory' },
  integrations: [
    mdx(),
    preact(),
    // Sitemap = prerendered pages minus noindex ones (noindex/draft guides, /alerts/thanks, API), plus published cities.
    sitemap({
      customPages: cityUrls,
      filter: (page) => !excludedGuides.has(new URL(page).pathname) && !/\/alerts\/thanks\/?$/.test(page) && !/\/api\//.test(page),
    }),
  ],
  vite: { plugins: [tailwindcss()] },
});
