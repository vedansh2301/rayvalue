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
import { UTILITY_PAGES, utilityPagePath } from './src/lib/utility/pages.ts';
import { getIndexableUtilityUrls } from './src/lib/utility/sitemap.ts';
import { isGoPath } from './src/lib/go.ts';
import { UNREVIEWED_PAGES } from './src/lib/seo/unreviewed-pages.ts';
import { adCspSources, parseAdIds } from './src/lib/ads/config.ts';
import { trustedFormCsp, trustedFormEnabled } from './src/lib/leads/consent-vendor.ts';

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

// Utility pages (on demand, from DB data) are listed only when their worked examples have real results.
process.env.SUPABASE_URL ||= dbEnv.SUPABASE_URL;
process.env.SUPABASE_PUBLISHABLE_KEY ||= dbEnv.SUPABASE_PUBLISHABLE_KEY;
const utilityUrls = process.env.SUPABASE_URL ? await getIndexableUtilityUrls() : [];

const utilityPaths = new Set(UTILITY_PAGES.map(utilityPagePath));

// Optional ad/measurement tags (GA4, Google Ads, Meta pixel): OFF unless an ID env var is set. Their third-party
// origins are added to the CSP only then. Enabling also needs the CLAUDE.md rule-7 amendment, the privacy policy,
// a consent banner and the matching change to the static CSP in vercel.json (see docs/LAUNCH.md).
const ads = adCspSources(parseAdIds({
  PUBLIC_GA4_ID: process.env.PUBLIC_GA4_ID || dbEnv.PUBLIC_GA4_ID,
  PUBLIC_GOOGLE_ADS_ID: process.env.PUBLIC_GOOGLE_ADS_ID || dbEnv.PUBLIC_GOOGLE_ADS_ID,
  PUBLIC_META_PIXEL_ID: process.env.PUBLIC_META_PIXEL_ID || dbEnv.PUBLIC_META_PIXEL_ID,
}));

// Optional TrustedForm consent-evidence script: OFF unless PUBLIC_TRUSTEDFORM_ENABLED=true (see docs/LAUNCH.md).
const tf = trustedFormCsp(trustedFormEnabled(process.env.PUBLIC_TRUSTEDFORM_ENABLED || dbEnv.PUBLIC_TRUSTEDFORM_ENABLED));
const thirdParty = {
  script: [...ads.script, ...tf.script],
  connect: [...ads.connect, ...tf.connect],
  img: [...ads.img, ...tf.img],
};

// noindex utility pages (confirmations, privacy request form).
const NOINDEX_UTILITY_PAGES = new Set(['/alerts/thanks', '/quotes/thank-you', '/quotes/thanks', '/privacy/request', '/privacy/request/thanks']);

export default defineConfig({
  site: 'https://rayvalue.com',
  output: 'static',
  // The confirmation page moved (kept for old links and bookmarks).
  redirects: { '/quotes/thanks': '/quotes/thank-you' },
  // Hashed CSP for every page. With the Vercel adapter's staticHeaders, Astro sends the policy as an HTTP
  // header for prerendered pages too (not a <meta> tag, where frame-ancestors would be ignored), and
  // on-demand pages send it from the function. These directives are added to script-src/style-src hashes.
  security: {
    csp: {
      directives: [
        ['connect-src', "'self'", ...thirdParty.connect].join(' '),
        ['img-src', "'self'", 'data:', ...thirdParty.img].join(' '),
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ],
      ...(thirdParty.script.length ? { scriptDirective: { resources: ["'self'", ...thirdParty.script] } } : {}),
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
      customPages: [...cityUrls, ...utilityUrls],
      filter: (page) => {
        const path = new URL(page).pathname.replace(/\/+$/, '') || '/';
        // On-demand utility routes are auto-discovered; keep only those whose data makes them indexable.
        if (utilityPaths.has(path) && !utilityUrls.includes(page)) return false;
        return !excludedGuides.has(path) && !excludedBlog.has(path) && !UNREVIEWED_PAGES.has(path) && !NOINDEX_UTILITY_PAGES.has(path) && !path.startsWith('/api/') && !path.startsWith('/admin') && !isGoPath(path) && path !== '/unsubscribe';
      },
    }),
  ],
  vite: { plugins: [tailwindcss()] },
});
