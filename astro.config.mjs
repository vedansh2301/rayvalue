import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://rayvalue.com',
  output: 'static',
  // Static pages stay prerendered; only src/pages/api/* opt out (prerender = false) and run as Vercel Functions.
  adapter: vercel(),
  integrations: [preact(), sitemap()],
  vite: { plugins: [tailwindcss()] },
});
