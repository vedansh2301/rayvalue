import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://rayvalue.com',
  output: 'static',
  integrations: [preact(), sitemap()],
  vite: { plugins: [tailwindcss()] },
});
