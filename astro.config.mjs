import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://rayvalue.com',
  output: 'static',
  // Static pages stay prerendered; only src/pages/api/* opt out (prerender = false) and run as Vercel Functions.
  adapter: vercel(),
  // Canonical policy: no trailing slash. @astrojs/vercel forces build.format 'directory'; Vercel serves /x from x/index.html.
  trailingSlash: 'never',
  build: { format: 'directory' },
  integrations: [
    mdx(),
    preact(),
    // Exclude noindex pages (alerts thanks) from the sitemap. Unpublished cities/drafts are never emitted or are handled by Task 6.
    sitemap({ filter: (page) => !/\/alerts\/thanks\/?$/.test(page) && !/\/api\//.test(page) }),
  ],
  vite: { plugins: [tailwindcss()] },
});
