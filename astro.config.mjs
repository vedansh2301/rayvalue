import { defineConfig } from 'astro/config';
import { readdirSync, readFileSync } from 'node:fs';
import mdx from '@astrojs/mdx';
import preact from '@astrojs/preact';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { UTILITY_PAGES } from './src/lib/utility/pages.ts';
import { routeRedirects } from './src/lib/content/paths.ts';
import { taxPath, usRedirects } from './src/lib/paths.ts';
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

// Entries with a keyword `route` live at that path and their default /guides/<id> path 301-redirects there.
const routed = [];
for (const [dir, base] of [['./src/content/guides', '/guides'], ['./src/content/blog', '/blog']]) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mdx'))) {
    const src = readFileSync(`${dir}/${f}`, 'utf8');
    const id = f.replace(/\.mdx$/, '');
    const route = /^route:\s*"?(\/[a-z0-9/-]+)"?\s*$/m.exec(src)?.[1];
    if (route) routed.push({ collection: base.slice(1), id, route });
  }
}
// The Florida and California tax pages were briefly blog posts; keep those URLs pointing at the keyword routes.
const articleRedirects = {
  ...routeRedirects(routed),
  '/blog/florida-solar-tax-benefits-2026': taxPath('FL'),
  '/blog/california-solar-tax-benefits-2026': taxPath('CA'),
};
// Old US paths (/calculator/<state>, /solar/<state>/<utility>, /solar-tax-benefits...) -> /us/ in one hop. City pages
// (/solar/<state>/<city>) are covered by the vercel.json pattern fallback, so DB cities need no entry here.
const legacyRedirects = usRedirects(UTILITY_PAGES);
const dbEnv = loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), '');
// Build-time pages (blog and guide cards) read the same DB env as the functions do.
process.env.SUPABASE_URL ||= dbEnv.SUPABASE_URL;
process.env.SUPABASE_PUBLISHABLE_KEY ||= dbEnv.SUPABASE_PUBLISHABLE_KEY;

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

export default defineConfig({
  site: 'https://rayvalue.com',
  output: 'static',
  // The confirmation page moved (kept for old links and bookmarks).
  redirects: {
    '/quotes/thanks': '/quotes/thank-you',
    // fl-vs-ca-reel's CTA names rayvalue.com/calculator; the home page links both state calculators.
    '/calculator': '/',
    // The old @astrojs/sitemap output; /sitemap.xml is now the one index.
    '/sitemap-index.xml': { status: 301, destination: '/sitemap.xml' },
    '/sitemap-0.xml': { status: 301, destination: '/sitemap.xml' },
    ...Object.fromEntries(Object.entries({ ...articleRedirects, ...legacyRedirects }).map(([from, to]) => [from, { status: 301, destination: to }])),
  },
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
  adapter: vercel({ staticHeaders: true, maxDuration: 60 }),
  // Canonical policy: no trailing slash. @astrojs/vercel forces build.format 'directory'; Vercel serves /x from x/index.html.
  trailingSlash: 'never',
  build: { format: 'directory' },
  integrations: [
    mdx(),
    preact(),
    // Sitemap, robots.txt and llms files are endpoints (src/pages/sitemap*.ts, robots.txt.ts, llms*.txt.ts) built from
    // src/lib/seo/site-index.ts, so there is no sitemap integration here.
  ],
  vite: { plugins: [tailwindcss()] },
});
