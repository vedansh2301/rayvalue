/**
 * Geometry and labels for the cumulative-savings chart on the results page. Pure: it only reshapes
 * engine outputs (CalcSuccess) into SVG coordinates and display strings; it invents no numbers.
 *  - likely line: cumulative likely bill savings, year 0 … analysisYears
 *  - band: cumulative savings between the low-outcome and high-outcome scenarios
 *  - cost line: the likely upfront cost (flat)
 *  - crossing: where the likely line reaches the cost, at the engine's likely payback (null if it never does)
 */
import type { CalcSuccess } from './types';

export const CHART_W = 360;
export const CHART_H = 250;
/** Font sizes in SVG units; the chart renders at its natural 360px width, so 1 unit = 1px (>= 11px on mobile). */
export const TICK_FONT = 13;
export const LABEL_FONT = 14;
/** Rough average glyph width of the bold label, as a fraction of its font size (for the label pill). */
const LABEL_CHAR_W = 0.58;
const ML = 50;
const MR = 14;
const MT = 16;
const MB = 40;

export interface ChartTick {
  /** SVG coordinate along the axis. */
  pos: number;
  label: string;
}
export interface ChartRow {
  year: number;
  low: number;
  likely: number;
  high: number;
}
export interface SavingsChart {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  xTicks: ChartTick[];
  yTicks: ChartTick[];
  likelyPath: string;
  bandPath: string;
  costY: number;
  costLabel: string;
  crossing: { x: number; y: number; years: number; label: string; labelX: number; labelY: number; anchor: 'start' | 'end'; pill: { x: number; y: number; width: number; height: number } } | null;
  rows: ChartRow[];
  title: string;
  desc: string;
}

type ChartSource = Pick<CalcSuccess, 'cost' | 'paybackYears' | 'analysisYears' | 'yearlySavings' | 'yearlySavingsLow' | 'yearlySavingsHigh'>;

const cumulative = (flows: readonly number[]): number[] => {
  const out = [0];
  for (const f of flows) out.push(out[out.length - 1]! + f);
  return out;
};

/** Round `max` up to a tidy axis maximum and return the tick step (about 4 intervals). */
export function niceAxis(max: number): { max: number; step: number } {
  if (!(max > 0)) return { max: 1, step: 1 };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  return { max: Math.ceil(max / step) * step, step };
}

const compactUsd = (n: number): string => (n === 0 ? '$0' : n >= 1000 ? `$${+(n / 1000).toFixed(1)}k` : `$${n}`);
const fullUsd = (n: number): string => `$${Math.round(n / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const yearsLabel = (y: number): string => `${Number.isInteger(y) ? y : y.toFixed(1)}`;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function buildSavingsChart(r: ChartSource): SavingsChart | null {
  const n = r.analysisYears;
  if (n < 1 || r.yearlySavings.length !== n || r.yearlySavingsLow.length !== n || r.yearlySavingsHigh.length !== n) return null;
  const likely = cumulative(r.yearlySavings);
  const low = cumulative(r.yearlySavingsLow);
  const high = cumulative(r.yearlySavingsHigh);
  const cost = r.cost.likely;
  if (!(high[n]! > 0)) return null;

  const axis = niceAxis(Math.max(high[n]!, cost));
  const left = ML;
  const right = CHART_W - MR;
  const top = MT;
  const bottom = CHART_H - MB;
  const x = (year: number) => r1(left + (year / n) * (right - left));
  const y = (usd: number) => r1(bottom - (usd / axis.max) * (bottom - top));
  const pts = (s: number[]) => s.map((v, i) => `${x(i)} ${y(v)}`);

  const likelyPath = `M${pts(likely).join(' L')}`;
  const bandPath = `M${pts(high).join(' L')} L${pts(low).reverse().join(' L')} Z`;

  const yTicks: ChartTick[] = [];
  for (let v = 0; v <= axis.max + axis.step / 1e6; v += axis.step) yTicks.push({ pos: y(v), label: compactUsd(Math.round(v)) });
  const xStep = n > 10 ? 5 : 1;
  const xTicks: ChartTick[] = [];
  for (let t = 0; t <= n; t += xStep) xTicks.push({ pos: x(t), label: String(t) });

  const pb = r.paybackYears.likely;
  const crossing =
    pb !== null && pb > 0 && pb <= n
      ? (() => {
          const cx = x(pb);
          const label = `Pays back ~year ${yearsLabel(pb)}`;
          const w = Math.ceil(label.length * LABEL_FONT * LABEL_CHAR_W);
          // Label sits above the cost line, left of the point (the savings line is below the cost line there); when it would run into the y-axis labels it goes below-right instead.
          const anchor: 'start' | 'end' = cx - 8 - w - 4 >= left ? 'end' : 'start';
          // Below-right labels are pulled left so the pill never runs past the plot's right edge (late paybacks).
          const labelX = anchor === 'end' ? r1(cx - 8) : r1(Math.max(left + 4, Math.min(cx + 8, right - w - 4)));
          const labelY = anchor === 'end' ? r1(Math.max(y(cost) - 9, top + LABEL_FONT)) : r1(y(cost) + 8 + LABEL_FONT);
          const pill = { x: r1(anchor === 'end' ? labelX - w - 4 : labelX - 4), y: r1(labelY - LABEL_FONT), width: w + 8, height: LABEL_FONT + 7 };
          return { x: cx, y: y(cost), years: pb, label, labelX, labelY, anchor, pill };
        })()
      : null;

  const marks = [...new Set([1, 5, 10, 15, 20, n].filter((m) => m >= 1 && m <= n))];
  const rows = marks.map((year) => ({ year, low: low[year]!, likely: likely[year]!, high: high[year]! }));

  const title = `Cumulative bill savings over ${n} years compared with upfront cost`;
  const desc =
    `Likely cumulative savings reach about ${fullUsd(likely[n]!)} by year ${n} (range ${fullUsd(low[n]!)} to ${fullUsd(high[n]!)}), against a likely upfront cost of ${fullUsd(cost)}. ` +
    (crossing ? `Savings pass the cost at about year ${yearsLabel(crossing.years)}.` : `Savings do not pass the cost within ${n} years.`);

  return { width: CHART_W, height: CHART_H, plot: { left, right, top, bottom }, xTicks, yTicks, likelyPath, bandPath, costY: y(cost), costLabel: `Upfront cost ${fullUsd(cost)}`, crossing, rows, title, desc };
}
