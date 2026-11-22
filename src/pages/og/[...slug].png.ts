import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { articlePath } from '../../lib/content/paths';
import { OG_PAGES, type OgPageKey } from '../../lib/seo/og';
import { UTILITY_PAGES, utilityPagePath } from '../../lib/utility/pages';

const SUN_MARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="7" fill="#fbbf24"/><g stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round"><path d="M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M6.8 25.2l2.8-2.8M22.4 9.6l2.8-2.8"/></g></svg>';
const require = createRequire(import.meta.url);
const readFont = (w: 400 | 700) =>
  readFileSync(require.resolve(`@fontsource/inter/files/inter-latin-${w}-normal.woff`));
const FONT_400 = readFont(400);
const FONT_700 = readFont(700);

/** Truncate with an ellipsis so long titles can't overflow the card. */
export const clampTitle = (t: string, max = 90) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}\u2026` : t);

export const getStaticPaths: GetStaticPaths = async () => {
  const guides = (await getCollection('guides')).filter((g) => !g.data.draft);
  const posts = (await getCollection('blog')).filter((p) => !p.data.draft);
  // Non-US articles use /og/<cc-segment>/<collection>/<slug>.png (GB under /uk/).
  const ogSlug = (c: 'guides' | 'blog', e: { id: string; data: { country: string } }) => (e.data.country === 'us' ? `${c}/${e.id}` : articlePath(c, e.id, undefined, e.data.country).slice(1));
  return [
    { params: { slug: 'default' }, props: { title: 'Solar payback, country by country', kicker: 'RayValue' } },
    ...(Object.keys(OG_PAGES) as OgPageKey[]).map((k) => ({ params: { slug: k }, props: OG_PAGES[k] as { title: string; kicker: string; subtitle: string } })),
    ...UTILITY_PAGES.map((u) => ({
      params: { slug: utilityPagePath(u).replace(/^\//, '') },
      props: { title: `Solar payback with ${u.short}`, kicker: u.state === 'FL' ? 'Florida utility' : 'California utility', subtitle: 'No federal tax credit' },
    })),
    ...guides.map((g) => ({ params: { slug: ogSlug('guides', g) }, props: { title: g.data.title, kicker: 'RayValue guide' } })),
    ...posts.map((p) => ({ params: { slug: ogSlug('blog', p) }, props: { title: p.data.title, kicker: 'RayValue blog' } })),
  ];
};

export const GET: APIRoute = async ({ props }) => {
  const { title, kicker, subtitle } = props as { title: string; kicker: string; subtitle?: string };
  const el = {
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative', width: 1200, height: 630, boxSizing: 'border-box', background: '#e6f1fb', padding: 72, fontFamily: 'Inter' },
      children: [
        { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: 16 }, children: [{ type: 'img', props: { src: `data:image/svg+xml;utf8,${encodeURIComponent(SUN_MARK_SVG)}`, width: 64, height: 64 } }, { type: 'div', props: { style: { display: 'flex', fontSize: 36, fontWeight: 700, color: '#92400e' }, children: kicker } }] } },
        { type: 'div', props: { style: { display: 'flex', fontSize: 68, fontWeight: 700, color: '#1c1917', lineHeight: 1.15, maxWidth: 1056 }, children: clampTitle(title) } },
        { type: 'div', props: { style: { display: 'flex', fontSize: 30, color: '#57534e' }, children: subtitle ? `${subtitle}  \u00b7  rayvalue.com` : 'rayvalue.com' } },
      ],
    },
  };
  const svg = await satori(el as any, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Inter', data: FONT_400, weight: 400, style: 'normal' },
      { name: 'Inter', data: FONT_700, weight: 700, style: 'normal' },
    ],
  });
  const png = new Resvg(svg).render().asPng();
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
