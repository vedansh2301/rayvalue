import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { OG_PAGES, type OgPageKey } from '../../lib/seo/og';

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
  return [
    { params: { slug: 'default' }, props: { title: 'Solar + battery payback, without the guesswork', kicker: 'RayValue' } },
    ...(Object.keys(OG_PAGES) as OgPageKey[]).map((k) => ({ params: { slug: k }, props: OG_PAGES[k] as { title: string; kicker: string; subtitle: string } })),
    ...guides.map((g) => ({ params: { slug: `guides/${g.id}` }, props: { title: g.data.title, kicker: 'RayValue guide' } })),
    ...posts.map((p) => ({ params: { slug: `blog/${p.id}` }, props: { title: p.data.title, kicker: 'RayValue blog' } })),
  ];
};

export const GET: APIRoute = async ({ props }) => {
  const { title, kicker, subtitle } = props as { title: string; kicker: string; subtitle?: string };
  const el = {
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: 1200, height: 630, boxSizing: 'border-box', background: '#fffbeb', padding: 72, fontFamily: 'Inter' },
      children: [
        { type: 'div', props: { style: { display: 'flex', fontSize: 36, fontWeight: 700, color: '#78350f' }, children: kicker } },
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
