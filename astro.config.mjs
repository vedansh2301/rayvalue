import { defineConfig } from 'astro/config';
import { readdirSync, readFileSync } from 'node:fs';
import mdx from '@astrojs/mdx';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { guideFlags, excludedGuideUrls, excludedCollectionUrls } from './src/lib/seo/guide-flags.ts';
import { getPublishedCityUrls } from './src/lib/seo/sitemap-cities.ts';
import { UNREVIEWED_PAGES } from './src/lib/seo/unreviewed-pages.ts';

// Server code reads secrets from process.env at request time (never import.meta.env, which Vite inlines
// into the function bundle). Under `astro dev`, load .env.local (from `vercel env pull`) into process.env.
if (process.argv.includes('dev')) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    /* no .env.local: DB pages show "being verified", /api/pvwatts returns 503 */
  }
}

const readFlags = (dir) =>
  readdirSync(dir).filter((f) => f.endsWith('.mdx')).map((f) => ({ id: f.replace(/\.mdx$/, ''), ...guideFlags(readFileSync(`${dir}/${f}`, 'utf8')) }));
const excludedGuides = excludedGuideUrls(readFlags('./src/content/guides'));
const excludedBlog = excludedCollectionUrls('/blog', readFlags('./src/content/blog'));

// Published city pages are on-demand, so list them for the sitemap from the DB at build time
// (offline / no env => [], build still succeeds). Unpublished cities are never listed.
const dbEnv = loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), '');
const cityUrls = await getPublishedCityUrls({
  url: process.env.SUPABASE_URL || dbEnv.SUPABASE_URL,
  key: process.env.SUPABASE_PUBLISHABLE_KEY || dbEnv.SUPABASE_PUBLISHABLE_KEY,
});

// noindex utility pages (confirmations, privacy request form).
const NOINDEX_UTILITY_PAGES = new Set(['/alerts/thanks', '/quotes/thanks', '/privacy/request', '/privacy/request/thanks']);

export default defineConfig({
  site: 'https://rayvalue.com',
  output: 'static',
  // Hashed CSP for every page. With the Vercel adapter's staticHeaders, Astro sends the policy as an HTTP
  // header for prerendered pages too (not a <meta> tag, where frame-ancestors would be ignored), and
  // on-demand pages send it from the function. These directives are added to script-src/style-src hashes.
  security: {
    csp: {
      directives: [
        "connect-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ],
    },
  },
  // Shiki emits inline styles, which the hashed CSP blocks; guides have no code blocks, so no highlighting.
  markdown: { syntaxHighlight: false },
  // Static pages stay prerendered. API routes and pages that read the Supabase calculator data
  // opt out (prerender = false) and run as Vercel Functions.
  adapter: vercel({ staticHeaders: true }),
  // Canonical policy: no trailing slash. @astrojs/vercel forces build.format 'directory'; Vercel serves /x from x/index.html.
  trailingSlash: 'never',
  build: { format: 'directory' },
  integrations: [
    mdx(),
    preact(),
    // Sitemap = prerendered pages minus noindex ones (noindex/draft guides, /guides while none is published,
    // unreviewed static pages, confirmation pages and the privacy request form, API), plus published cities.
    sitemap({
      customPages: cityUrls,
      filter: (page) => {
        const path = new URL(page).pathname.replace(/\/+$/, '') || '/';
        return !excludedGuides.has(path) && !excludedBlog.has(path) && !UNREVIEWED_PAGES.has(path) && !NOINDEX_UTILITY_PAGES.has(path) && !path.startsWith('/api/');
      },
    }),
  ],
  vite: { plugins: [tailwindcss()] },
});
