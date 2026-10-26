/**
 * Slide layout: turns a Slide (data only, from src/lib/social/gen) into a satori element tree. Draws, never writes copy
 * or computes figures. Palette = the Tailwind theme in src/styles/global.css (sun amber, stone neutrals).
 */
import { fitFontSize } from '../../src/lib/social/gen/fit';
import type { Row, Slide, SlideTheme, Tile } from '../../src/lib/social/gen/types';

export type Format = 'reel' | 'carousel';

export const SIZES = { reel: { width: 1080, height: 1920 }, carousel: { width: 1080, height: 1350 } } as const;

// Instagram draws its own UI over the top and bottom of a Reel, so keep copy inside these margins.
const PAD = {
  reel: { top: 190, bottom: 400, x: 84 },
  carousel: { top: 84, bottom: 84, x: 84 },
} as const;

interface Palette {
  bg: string;
  fg: string;
  muted: string;
  kicker: string;
  card: string;
  cardBorder: string;
  emphBg: string;
  emphFg: string;
  glow: string[];
}

const PALETTE: Record<SlideTheme, Palette> = {
  light: { bg: '#fffbeb', fg: '#1c1917', muted: '#57534e', kicker: '#92400e', card: '#ffffff', cardBorder: '#e7e5e4', emphBg: '#1c1917', emphFg: '#fffbeb', glow: ['rgba(251,191,36,0.20)', 'rgba(251,191,36,0.14)'] },
  sun: { bg: 'linear-gradient(160deg, #fde68a 0%, #fbbf24 55%, #f59e0b 100%)', fg: '#1c1917', muted: '#292524', kicker: '#451a03', card: 'rgba(255,255,255,0.6)', cardBorder: 'rgba(28,25,23,0.18)', emphBg: '#1c1917', emphFg: '#fcd34d', glow: ['rgba(255,255,255,0.26)', 'rgba(255,255,255,0.30)'] },
  dark: { bg: '#1c1917', fg: '#fffbeb', muted: '#d6d3d1', kicker: '#fcd34d', card: '#292524', cardBorder: '#44403c', emphBg: '#fcd34d', emphFg: '#1c1917', glow: ['rgba(252,211,77,0.10)', 'rgba(252,211,77,0.08)'] },
};

type Style = Record<string, string | number>;
export interface El {
  type: string;
  props: { style: Style; children?: unknown };
}

/** satori needs display:flex on any element with more than one child, so every box is a flex column unless told otherwise. */
const box = (style: Style, children?: unknown): El => ({ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', boxSizing: 'border-box', ...style }, children } });
const txt = (style: Style, s: string): El => box({ ...style }, s);

function sunMark(size: number, p: Palette): El {
  return box({ width: size, height: size, borderRadius: size, backgroundColor: '#f59e0b', border: `${Math.round(size / 7)}px solid ${p.fg === '#1c1917' ? '#1c1917' : '#fcd34d'}` });
}

function header(p: Palette, page: { n: number; total: number } | null): El {
  return box({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }, [
    box({ flexDirection: 'row', alignItems: 'center', gap: 18 }, [sunMark(52, p), txt({ fontSize: 44, fontWeight: 800, color: p.fg, letterSpacing: -1 }, 'RayValue')]),
    page ? txt({ fontSize: 34, fontWeight: 700, color: p.muted }, `${page.n} / ${page.total}`) : box({}),
  ]);
}

function titleSize(title: string, kind: 'hook' | 'figure'): number {
  const n = title.length;
  if (kind === 'hook') return n <= 24 ? 124 : n <= 40 ? 108 : n <= 60 ? 92 : 78;
  return n <= 30 ? 72 : n <= 50 ? 64 : 56;
}

const kicker = (s: string, p: Palette) => txt({ fontSize: 34, fontWeight: 800, color: p.kicker, textTransform: 'uppercase', letterSpacing: 4 }, s);

function bigFigure(s: Slide, p: Palette, width: number): El {
  const one = fitFontSize(s.big!, width - 80, 132, 60, 1);
  const size = one >= 96 ? one : fitFontSize(s.big!, width - 80, 132, 60, 2);
  return box({ backgroundColor: p.card, border: `3px solid ${p.cardBorder}`, borderRadius: 40, padding: '38px 40px', gap: 14 }, [
    txt({ fontSize: size, fontWeight: 800, color: p.fg, letterSpacing: -2, lineHeight: 1.05 }, s.big!),
    ...(s.bigLabel ? [txt({ fontSize: 32, color: p.muted, lineHeight: 1.25 }, s.bigLabel)] : []),
  ]);
}

function tileRow(tiles: Tile[], p: Palette, width: number): El {
  const gap = 20;
  const inner = Math.floor((width - gap * (tiles.length - 1)) / tiles.length) - 48;
  return box(
    { flexDirection: 'row', gap, width: '100%' },
    tiles.map((t) =>
      box(
        {
          flex: 1,
          borderRadius: 30,
          padding: '26px 24px',
          gap: 10,
          backgroundColor: t.emphasis ? p.emphBg : p.card,
          border: `3px solid ${t.emphasis ? p.emphBg : p.cardBorder}`,
        },
        [
          txt({ fontSize: 28, fontWeight: 700, color: t.emphasis ? p.emphFg : p.muted, textTransform: 'uppercase', letterSpacing: 2 }, t.label),
          txt({ fontSize: fitFontSize(t.value, inner, 58, 36, 2), fontWeight: 800, color: t.emphasis ? p.emphFg : p.fg, lineHeight: 1.08 }, t.value),
        ],
      ),
    ),
  );
}

function rowList(rows: Row[], p: Palette, width: number): El {
  const inner = width - 84;
  return box(
    { gap: 22, width: '100%' },
    rows.map((r) =>
      box({ backgroundColor: p.card, border: `3px solid ${p.cardBorder}`, borderRadius: 32, padding: '26px 38px', gap: 6 }, [
        txt({ fontSize: 38, fontWeight: 700, color: p.muted }, r.label),
        txt({ fontSize: fitFontSize(r.value, inner, 68, 40, 2), fontWeight: 800, color: p.fg, letterSpacing: -1, lineHeight: 1.05 }, r.value),
        ...(r.hint ? r.hint.split('\n').map((h) => txt({ fontSize: 32, color: p.muted, lineHeight: 1.25 }, h)) : []),
      ]),
    ),
  );
}

function bulletList(items: string[], p: Palette): El {
  return box(
    { gap: 26, width: '100%' },
    items.map((b) =>
      box({ flexDirection: 'row', alignItems: 'center', gap: 28 }, [
        box({ width: 24, height: 24, borderRadius: 24, backgroundColor: '#f59e0b', flexShrink: 0 }),
        txt({ fontSize: 48, fontWeight: 700, color: p.fg, lineHeight: 1.2 }, b),
      ]),
    ),
  );
}

export function slideElement(s: Slide, format: Format, page: { n: number; total: number } | null): El {
  const { width, height } = SIZES[format];
  const pad = PAD[format];
  const p = PALETTE[s.theme];
  const inner = width - pad.x * 2;
  const isHook = s.id === 'hook' || s.id === 'cover';
  const hasFigures = !!(s.big || s.rows || s.tiles);

  const body: El[] = [];
  if (s.kicker) body.push(kicker(s.kicker, p));
  body.push(txt({ fontSize: titleSize(s.title, isHook ? 'hook' : 'figure'), fontWeight: 800, color: p.fg, letterSpacing: -2, lineHeight: 1.08 }, s.title));
  if (s.subtitle) body.push(txt({ fontSize: isHook ? 48 : 38, color: p.muted, lineHeight: 1.28 }, s.subtitle));
  if (s.big) body.push(box({ marginTop: 18 }, [bigFigure(s, p, inner)]));
  if (s.tiles) body.push(tileRow(s.tiles, p, inner));
  if (s.rows) body.push(box({ marginTop: 10 }, [rowList(s.rows, p, inner)]));
  if (s.bullets) body.push(box({ marginTop: 20 }, [bulletList(s.bullets, p)]));
  for (const line of s.lines ?? []) body.push(txt({ fontSize: hasFigures ? 32 : 46, color: hasFigures ? p.muted : p.fg, lineHeight: 1.3, fontWeight: hasFigures ? 400 : 700 }, line));
  if (s.url) {
    body.push(
      box({ alignSelf: 'flex-start', marginTop: 14, backgroundColor: p.emphBg, borderRadius: 28, padding: '28px 40px' }, [
        txt({ fontSize: fitFontSize(s.url, inner - 80, 56, 34), fontWeight: 800, color: p.emphFg }, s.url),
      ]),
    );
  }

  const footer = s.footer?.length ? box({ gap: 6 }, s.footer.map((f) => txt({ fontSize: 30, color: p.muted, lineHeight: 1.25 }, f))) : box({});

  return box(
    {
      position: 'relative',
      width,
      height,
      overflow: 'hidden',
      fontFamily: 'Inter',
      ...(p.bg.startsWith('linear') ? { backgroundImage: p.bg, backgroundColor: '#fbbf24' } : { backgroundColor: p.bg }),
      padding: `${pad.top}px ${pad.x}px ${pad.bottom}px`,
    },
    [
      box({ position: 'absolute', right: -260, top: -220, width: 820, height: 820, borderRadius: 820, backgroundColor: p.glow[0]! }),
      box({ position: 'absolute', right: -90, top: -50, width: 480, height: 480, borderRadius: 480, backgroundColor: p.glow[1]! }),
      box({ position: 'relative', width: '100%' }, [header(p, page)]),
      box({ position: 'relative', flex: 1, justifyContent: 'center', gap: 26 }, body),
      box({ position: 'relative' }, [footer]),
    ],
  );
}
