import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const require = createRequire(import.meta.url);
const font = (w: 400 | 700) =>
  readFileSync(require.resolve(`@fontsource/inter/files/inter-latin-${w}-normal.woff`));

export const getStaticPaths: GetStaticPaths = async () => {
  const guides = (await getCollection('guides')).filter((g) => !g.data.draft);
  return [
    { params: { slug: 'default' }, props: { title: 'Solar + battery payback, without the guesswork', kicker: 'RayValue' } },
    ...guides.map((g) => ({ params: { slug: `guides/${g.id}` }, props: { title: g.data.title, kicker: 'RayValue guide' } })),
  ];
};

export const GET: APIRoute = async ({ props }) => {
  const { title, kicker } = props as { title: string; kicker: string };
  const el = {
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: '100%', height: '100%', background: '#fffbeb', padding: 72, fontFamily: 'Inter' },
      children: [
        { type: 'div', props: { style: { display: 'flex', fontSize: 36, fontWeight: 700, color: '#78350f' }, children: kicker } },
        { type: 'div', props: { style: { display: 'flex', fontSize: 68, fontWeight: 700, color: '#1c1917', lineHeight: 1.15 }, children: title } },
        { type: 'div', props: { style: { display: 'flex', fontSize: 30, color: '#57534e' }, children: 'rayvalue.com' } },
      ],
    },
  };
  const svg = await satori(el as any, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Inter', data: font(400), weight: 400, style: 'normal' },
      { name: 'Inter', data: font(700), weight: 700, style: 'normal' },
    ],
  });
  const png = new Resvg(svg).render().asPng();
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
