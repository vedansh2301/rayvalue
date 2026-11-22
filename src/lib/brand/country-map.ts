/**
 * Where each country's outline sits on the home page world map (viewBox 0 0 1000 470, equirectangular, lon -170..190,
 * lat 78..-60). A drawing aid only: geometry, no figures. `size` is the length in map units of the outline's longest
 * side (the outline boxes in country-outlines.ts are 100 units on that side), so shapes keep a rough real-world scale.
 * Outline paths are Natural Earth (public domain), credited on /credits.
 */
import { COUNTRY_OUTLINES } from './country-outlines.ts';

export const MAP_VIEWBOX = { w: 1000, h: 470 } as const;

/** [lon, lat, size] by URL segment (GB is "uk"). */
export const MAP_POSITIONS: Readonly<Record<string, readonly [number, number, number]>> = {
  us: [-98, 39, 150], ca: [-98, 57, 150], br: [-53, -11, 115], cl: [-71, -36, 120], co: [-73, 4, 42], ar: [-64, -38.5, 112], pe: [-75.5, -9.5, 56],
  do: [-70.2, 18.9, 12], jm: [-77.3, 18.1, 9],
  uk: [-2.5, 54.5, 30], ie: [-8, 53.3, 16], fr: [2.5, 46.6, 32], de: [10.4, 51.2, 28], es: [-3.7, 40.2, 34], pt: [-8.2, 39.6, 17],
  it: [12.5, 42.6, 32], nl: [5.4, 52.2, 11], be: [4.6, 50.6, 9], ch: [8.2, 46.8, 11], at: [14.4, 47.6, 17], cz: [15.5, 49.8, 17],
  pl: [19.4, 52, 22], dk: [10, 56, 13], se: [16.5, 62.5, 52], no: [14, 65, 60], fi: [26, 64.5, 42], ro: [25, 45.9, 22],
  au: [134, -26, 118], in: [79, 22, 86], jp: [137, 37, 52], za: [25, -29, 50], il: [35, 31, 14],
};

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Map-space centre of a point, rounded to 0.1. */
export function mapXY(lon: number, lat: number): [number, number] {
  return [r1(((lon + 170) / 360) * MAP_VIEWBOX.w), r1((78 - lat) * (MAP_VIEWBOX.h / 138))];
}

export interface MapShape { segment: string; d: string; transform: string; cx: number; cy: number }

/** SVG shape for a country on the map (translate + scale of its outline), or null when it has no outline or position. */
export function mapShape(segment: string): MapShape | null {
  const o = COUNTRY_OUTLINES[segment];
  const p = MAP_POSITIONS[segment];
  if (!o || !p) return null;
  const k = p[2] / 100;
  const [x, y] = mapXY(p[0], p[1]);
  return { segment, d: o.d, transform: `translate(${r1(x - (o.w * k) / 2)} ${r1(y - (o.h * k) / 2)}) scale(${k})`, cx: x, cy: y };
}
