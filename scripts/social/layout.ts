/**
 * Slide layout, in two layers so a Reel can move them separately:
 *  - background: the slide's licensed photo under a dark gradient scrim (or a plain themed fill when it has none),
 *    drawn here as SVG overlays that render.ts composites onto the photo with sharp;
 *  - text: a transparent satori element tree with the logo, copy, figure panels and footer.
 * Draws, never writes copy or computes figures; the only text it adds is the photo credit a license requires.
 * Palette = the Tailwind theme in src/styles/global.css (sun amber, stone neutrals); the logo is the site's sun mark.
 */
import { fitFontSize } from '../../src/lib/social/gen/fit';
import { photoByKey } from '../../src/lib/social/gen/photos';
import type { Row, Slide, SlideTheme, Tile } from '../../src/lib/social/gen/types';

export type Format = 'reel' | 'carousel';

export const SIZES = { reel: { width: 1080, height: 1920 }, carousel: { width: 1080, height: 1350 } } as const;

/**
 * Copy margins. Reels: Instagram and Facebook draw their own UI over the top ~200 px, the bottom ~400 px (caption,
 * account, audio) and a column of buttons on the right, so copy stays inside these. Carousels are not covered.
 */
export const SAFE = {
  reel: { top: 200, bottom: 400, left: 88, right: 112 },
  carousel: { top: 76, bottom: 76, left: 80, right: 80 },
} as const;

/** Colors for one slide. Page-level text sits on the background; card text sits on the figure panels. */
interface Palette {
  fg: string;
  muted: string;
  kicker: string;
  /** Text shadow for page-level text (photo slides only). */
  shadow: string | null;
  card: string;
  cardBorder: string;
  cardFg: string;
  cardMuted: string;
  /** The "likely" tile and the URL pill. */
  emphBg: string;
  emphFg: string;
  dot: string;
}

const STONE_950 = '#0c0a09';
const AMBER = { 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', ink: '#92400e', deep: '#451a03' } as const;

const ON_PHOTO = { fg: '#ffffff', muted: 'rgba(255,255,255,0.84)', kicker: AMBER[300], shadow: '0 2px 24px rgba(0,0,0,0.55)', emphBg: AMBER[400], emphFg: '#1c1917', dot: AMBER[400] } as const;

const PHOTO_PALETTE: Record<SlideTheme, Palette> = {
  // Hook and call to action: warm glass panels.
  sun: { ...ON_PHOTO, card: 'rgba(28,25,23,0.66)', cardBorder: 'rgba(252,211,77,0.38)', cardFg: '#ffffff', cardMuted: 'rgba(255,255,255,0.78)' },
  // Data slides: cream panels, dark figures.
  light: { ...ON_PHOTO, card: 'rgba(255,251,235,0.95)', cardBorder: 'rgba(255,255,255,0.0)', cardFg: '#1c1917', cardMuted: '#57534e' },
  dark: { ...ON_PHOTO, card: 'rgba(12,10,9,0.70)', cardBorder: 'rgba(255,255,255,0.16)', cardFg: '#ffffff', cardMuted: 'rgba(255,255,255,0.74)' },
};

/** Slides without a photo (fixtures, a missing file): flat themed backgrounds. */
const PLAIN_PALETTE: Record<SlideTheme, Palette> = {
  sun: { fg: '#1c1917', muted: '#292524', kicker: AMBER.deep, shadow: null, card: 'rgba(255,255,255,0.62)', cardBorder: 'rgba(28,25,23,0.14)', cardFg: '#1c1917', cardMuted: '#44403c', emphBg: '#1c1917', emphFg: AMBER[300], dot: '#1c1917' },
  light: { fg: '#1c1917', muted: '#57534e', kicker: AMBER.ink, shadow: null, card: '#ffffff', cardBorder: '#e7e5e4', cardFg: '#1c1917', cardMuted: '#57534e', emphBg: AMBER[400], emphFg: '#1c1917', dot: AMBER[500] },
  dark: { fg: '#fffbeb', muted: '#d6d3d1', kicker: AMBER[300], shadow: null, card: '#292524', cardBorder: '#44403c', cardFg: '#fffbeb', cardMuted: '#d6d3d1', emphBg: AMBER[400], emphFg: '#1c1917', dot: AMBER[400] },
};

export const paletteFor = (s: Slide): Palette => (s.photo ? PHOTO_PALETTE : PLAIN_PALETTE)[s.theme];

// ------------------------------------------------------------------ background layer (SVG, composited by render.ts)
/** Slides whose copy sits low on the frame (photo shows above it) rather than centred. */
export const isBottomAligned = (s: Slide) => s.id === 'hook' || s.id === 'cover' || s.id === 'cta';

const stop = (offset: number, color: string, opacity: number) => `<stop offset="${offset}" stop-color="${color}" stop-opacity="${opacity}"/>`;

/**
 * The scrim drawn over a photo, `width` x `height` (any scale). Darkest where the copy sits: low on hook / CTA slides,
 * through the middle on data slides, always at the top (logo) and the very bottom (platform caption).
 */
export function scrimSvg(s: Slide, width: number, height: number): string {
  const low = isBottomAligned(s);
  const ramp = low
    ? [stop(0, STONE_950, 0.62), stop(0.16, STONE_950, 0.22), stop(0.42, STONE_950, 0.28), stop(0.66, STONE_950, 0.8), stop(1, STONE_950, 0.94)]
    : [stop(0, STONE_950, 0.78), stop(0.18, STONE_950, 0.66), stop(0.5, STONE_950, 0.76), stop(0.8, STONE_950, 0.86), stop(1, STONE_950, 0.94)];
  // Sun slides get a warm glow from the top right; the others a faint cool vignette.
  const glow =
    s.theme === 'sun'
      ? `<radialGradient id="g" cx="0.92" cy="0.06" r="0.75">${stop(0, AMBER[500], 0.5)}${stop(0.55, AMBER[500], 0.12)}${stop(1, AMBER[500], 0)}</radialGradient>`
      : `<radialGradient id="g" cx="0.5" cy="0.45" r="0.85">${stop(0.55, STONE_950, 0)}${stop(1, STONE_950, 0.45)}</radialGradient>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="v" x1="0" y1="0" x2="0" y2="1">${ramp.join('')}</linearGradient>${glow}</defs><rect width="100%" height="100%" fill="url(#v)"/><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
}

/** A full background for a slide with no photo. */
export function plainBackgroundSvg(theme: SlideTheme, width: number, height: number): string {
  const k = width / 1080;
  const circle = (cx: number, cy: number, r: number, fill: string) => `<circle cx="${cx * k}" cy="${cy * k}" r="${r * k}" fill="${fill}"/>`;
  if (theme === 'sun') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="b" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="0.55" stop-color="${AMBER[400]}"/><stop offset="1" stop-color="${AMBER[500]}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#b)"/>${circle(950, 150, 410, 'rgba(255,255,255,0.26)')}${circle(950, 150, 240, 'rgba(255,255,255,0.30)')}</svg>`;
  }
  const [bg, glowA, glowB] = theme === 'light' ? ['#fffbeb', 'rgba(251,191,36,0.20)', 'rgba(251,191,36,0.14)'] : ['#1c1917', 'rgba(252,211,77,0.10)', 'rgba(252,211,77,0.08)'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${bg}"/>${circle(950, 150, 410, glowA)}${circle(950, 150, 240, glowB)}</svg>`;
}

// ------------------------------------------------------------------ text layer (satori)
type Style = Record<string, string | number>;
export interface El {
  type: string;
  props: { style: Style; children?: unknown; src?: string; width?: number; height?: number };
}

/** satori needs display:flex on any element with more than one child, so every box is a flex column unless told otherwise. */
const box = (style: Style, children?: unknown): El => ({ type: 'div', props: { style: { display: 'flex', flexDirection: 'column', boxSizing: 'border-box', ...style }, children } });
const txt = (style: Style, s: string): El => box({ ...style }, s);
const shadowed = (p: Palette): Style => (p.shadow ? { textShadow: p.shadow } : {});

/** The site's sun mark (public/favicon.svg). */
const SUN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="7" fill="#fbbf24"/><g stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round"><path d="M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M6.8 25.2l2.8-2.8M22.4 9.6l2.8-2.8"/></g></svg>';
const SUN_SRC = `data:image/svg+xml;base64,${Buffer.from(SUN_SVG).toString('base64')}`;

function logo(p: Palette): El {
  return box({ flexDirection: 'row', alignItems: 'center', gap: 14 }, [
    { type: 'img', props: { src: SUN_SRC, width: 64, height: 64, style: { width: 64, height: 64 } } },
    txt({ fontSize: 44, fontWeight: 800, color: p.fg, letterSpacing: -1, ...shadowed(p) }, 'RayValue'),
  ]);
}

function header(p: Palette, page: { n: number; total: number } | null): El {
  return box({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }, [
    logo(p),
    page
      ? box({ flexDirection: 'row', alignItems: 'center', borderRadius: 999, padding: '10px 22px', backgroundColor: p.card, border: `2px solid ${p.cardBorder}` }, [
          txt({ fontSize: 30, fontWeight: 700, color: p.cardMuted }, `${page.n} / ${page.total}`),
        ])
      : box({}),
  ]);
}

function titleSize(title: string, kind: 'hook' | 'figure'): number {
  const n = title.length;
  if (kind === 'hook') return n <= 24 ? 128 : n <= 40 ? 112 : n <= 60 ? 94 : 80;
  return n <= 30 ? 76 : n <= 50 ? 66 : 58;
}

function kicker(s: string, p: Palette): El {
  return box({ flexDirection: 'row', alignItems: 'center', gap: 18 }, [
    box({ width: 44, height: 6, borderRadius: 6, backgroundColor: p.kicker }),
    txt({ fontSize: 32, fontWeight: 800, color: p.kicker, textTransform: 'uppercase', letterSpacing: 4, ...shadowed(p) }, s),
  ]);
}

/** A tile value on one line when it fits at a readable size, else on two. */
function tileSize(value: string, width: number): number {
  const one = fitFontSize(value, width, 56, 34, 1);
  return one >= 40 ? one : fitFontSize(value, width, 56, 34, 2);
}

/** Low / likely / high tiles; the emphasized ("likely") one is amber. `inner` = the row's width. */
function tileRow(tiles: Tile[], p: Palette, inner: number): El {
  const gap = 16;
  const each = Math.floor((inner - gap * (tiles.length - 1)) / tiles.length) - 44;
  return box(
    { flexDirection: 'row', gap, width: '100%' },
    tiles.map((t) => {
      const on = !!t.emphasis;
      return box(
        {
          flex: 1,
          borderRadius: 26,
          padding: '22px 22px 24px',
          gap: 8,
          backgroundColor: on ? p.emphBg : 'rgba(127,127,127,0.12)',
          border: `2px solid ${on ? p.emphBg : 'rgba(127,127,127,0.22)'}`,
        },
        [
          txt({ fontSize: 26, fontWeight: 800, color: on ? p.emphFg : p.cardMuted, textTransform: 'uppercase', letterSpacing: 2 }, t.label),
          txt({ fontSize: tileSize(t.value, each), fontWeight: 800, color: on ? p.emphFg : p.cardFg, lineHeight: 1.06, letterSpacing: -1 }, t.value),
        ],
      );
    }),
  );
}

/** The headline range, its label and the tiles, in one panel. */
function figurePanel(s: Slide, p: Palette, width: number): El {
  const inner = width - 80;
  const one = fitFontSize(s.big ?? '', inner, 136, 60, 1);
  const size = one >= 72 ? one : fitFontSize(s.big ?? '', inner, 136, 60, 2);
  const kids: El[] = [];
  if (s.big) kids.push(txt({ fontSize: size, fontWeight: 800, color: p.cardFg, letterSpacing: -3, lineHeight: 1.02 }, s.big));
  if (s.bigLabel) kids.push(txt({ fontSize: 31, color: p.cardMuted, lineHeight: 1.25 }, s.bigLabel));
  if (s.tiles) kids.push(box({ marginTop: 14, width: '100%' }, [tileRow(s.tiles, p, inner)]));
  return box({ backgroundColor: p.card, border: `2px solid ${p.cardBorder}`, borderRadius: 40, padding: '36px 40px 40px', gap: 12, width: '100%' }, kids);
}

function rowList(rows: Row[], p: Palette, width: number): El {
  const inner = width - 80;
  return box(
    { gap: 18, width: '100%' },
    rows.map((r) =>
      box({ flexDirection: 'row', alignItems: 'stretch', backgroundColor: p.card, border: `2px solid ${p.cardBorder}`, borderRadius: 32, overflow: 'hidden' }, [
        box({ width: 12, backgroundColor: p.emphBg }),
        box({ flex: 1, padding: '24px 34px 26px', gap: 4 }, [
          txt({ fontSize: 34, fontWeight: 700, color: p.cardMuted }, r.label),
          txt({ fontSize: fitFontSize(r.value, inner, 68, 40, 2), fontWeight: 800, color: p.cardFg, letterSpacing: -1.5, lineHeight: 1.04 }, r.value),
          ...(r.hint ? r.hint.split('\n').map((h) => txt({ fontSize: 30, color: p.cardMuted, lineHeight: 1.25 }, h)) : []),
        ]),
      ]),
    ),
  );
}

function bulletList(items: string[], p: Palette): El {
  return box(
    { backgroundColor: p.card, border: `2px solid ${p.cardBorder}`, borderRadius: 36, padding: '34px 38px', gap: 26, width: '100%' },
    items.map((b) =>
      box({ flexDirection: 'row', alignItems: 'center', gap: 26 }, [
        box({ width: 22, height: 22, borderRadius: 22, backgroundColor: p.dot, flexShrink: 0 }),
        txt({ fontSize: 44, fontWeight: 700, color: p.cardFg, lineHeight: 1.2 }, b),
      ]),
    ),
  );
}

/** The license-required photo credit, or null when the photo needs none. */
export function creditLine(s: Slide): string | null {
  if (!s.photo) return null;
  const photo = photoByKey(s.photo);
  return photo.attribution ? `Photo: ${photo.credit} · ${photo.license}` : null;
}

/** The text layer: transparent everywhere except the copy. */
export function textElement(s: Slide, format: Format, page: { n: number; total: number } | null): El {
  const { width, height } = SIZES[format];
  const safe = SAFE[format];
  const p = paletteFor(s);
  const inner = width - safe.left - safe.right;
  const isHook = s.id === 'hook' || s.id === 'cover';
  const hasFigures = !!(s.big || s.rows || s.tiles);

  const body: El[] = [];
  if (s.kicker) body.push(kicker(s.kicker, p));
  body.push(txt({ fontSize: titleSize(s.title, isHook ? 'hook' : 'figure'), fontWeight: 800, color: p.fg, letterSpacing: isHook ? -3 : -2, lineHeight: 1.04, ...shadowed(p) }, s.title));
  if (s.subtitle) body.push(txt({ fontSize: isHook ? 46 : 36, fontWeight: isHook ? 700 : 400, color: p.muted, lineHeight: 1.28, ...shadowed(p) }, s.subtitle));
  if (s.big || s.tiles) body.push(box({ marginTop: 16, width: '100%' }, [figurePanel(s, p, inner)]));
  if (s.rows) body.push(box({ marginTop: 10, width: '100%' }, [rowList(s.rows, p, inner)]));
  if (s.bullets) body.push(box({ marginTop: 16, width: '100%' }, [bulletList(s.bullets, p)]));
  for (const line of s.lines ?? []) {
    body.push(txt({ fontSize: hasFigures ? 30 : 44, color: hasFigures ? p.muted : p.fg, lineHeight: 1.3, fontWeight: hasFigures ? 400 : 700, ...shadowed(p) }, line));
  }
  if (s.url) {
    body.push(
      box({ alignSelf: 'flex-start', marginTop: 16, backgroundColor: p.emphBg, borderRadius: 999, padding: '26px 44px', boxShadow: '0 10px 40px rgba(0,0,0,0.35)' }, [
        txt({ fontSize: fitFontSize(s.url, inner - 88, 54, 32), fontWeight: 800, color: p.emphFg, letterSpacing: -0.5 }, s.url),
      ]),
    );
  }

  const small = [...(s.footer ?? [])];
  const credit = creditLine(s);
  if (credit) small.push(credit);
  const footer = small.length ? box({ gap: 4 }, small.map((f) => txt({ fontSize: 26, color: p.muted, lineHeight: 1.3, ...shadowed(p) }, f))) : box({});

  return box(
    {
      position: 'relative',
      width,
      height,
      overflow: 'hidden',
      fontFamily: 'Inter',
      padding: `${safe.top}px ${safe.right}px ${safe.bottom}px ${safe.left}px`,
    },
    [
      box({ width: '100%' }, [header(p, page)]),
      box({ flex: 1, justifyContent: isBottomAligned(s) ? 'flex-end' : 'center', gap: 24, paddingBottom: isBottomAligned(s) ? 36 : 0 }, body),
      footer,
    ],
  );
}
