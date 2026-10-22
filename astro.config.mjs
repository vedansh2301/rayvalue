import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { getPublishedCityUrls } from './src/lib/seo/sitemap-cities.ts';

// Published city pages are on-demand, so list them for the sitemap from the DB (offline => []).
const dbEnv = loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), '');
const cityUrls = await getPublishedCityUrls({
  url: process.env.SUPABASE_URL || dbEnv.SUPABASE_URL,
  key: process.env.SUPABASE_PUBLISHABLE_KEY || dbEnv.SUPABASE_PUBLISHABLE_KEY,
});

export default defineConfig({
  site: 'https://rayvalue.com',
  output: 'static',
  // Static pages stay prerendered; only src/pages/api/* opt out (prerender = false) and run as Vercel Functions.
  adapter: vercel(),
  integrations: [preact(), sitemap({ customPages: cityUrls })],
  vite: { plugins: [tailwindcss()] },
});
