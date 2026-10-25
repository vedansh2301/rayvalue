/** Chart geometry on hand-worked SYNTHETIC numbers (never shipped). */
import { describe, expect, it } from 'vitest';
import { buildSavingsChart, niceAxis, CHART_H, CHART_W } from './chart';

const src = (over: Record<string, unknown> = {}) => ({
  cost: { low: 8000, likely: 10000, high: 12000 },
  paybackYears: { low: 4, likely: 5, high: 7 },
  analysisYears: 4,
  yearlySavings: [2000, 2000, 2000, 2000],
  yearlySavingsLow: [1000, 1000, 1000, 1000],
  yearlySavingsHigh: [3000, 3000, 3000, 3000],
  ...over,
});

describe('niceAxis', () => {
  it('rounds up to a tidy maximum', () => {
    expect(niceAxis(9000)).toEqual({ max: 10000, step: 2500 });
    expect(niceAxis(37200)).toEqual({ max: 40000, step: 10000 });
    expect(niceAxis(0)).toEqual({ max: 1, step: 1 });
  });
});

describe('buildSavingsChart', () => {
  it('maps cumulative series into the plot box (year 0 = $0 at bottom-left, last year at the right)', () => {
    // cumulative likely 0,2000,4000,6000,8000; high 12000 at year 4; cost 10000 -> axis max 12000? step from 3000 -> 12000
    const c = buildSavingsChart(src())!;
    expect(c.plot).toEqual({ left: 46, right: CHART_W - 12, top: 14, bottom: CHART_H - 30 });
    expect(c.likelyPath.startsWith(`M46 ${c.plot.bottom} L`)).toBe(true);
    expect(c.rows.at(-1)).toEqual({ year: 4, low: 4000, likely: 8000, high: 12000 });
    expect(c.rows[0]).toEqual({ year: 1, low: 1000, likely: 2000, high: 3000 });
    // y of $10,000 on a $15,000 axis (step 5,000): bottom - 10/12 * height
    const h = c.plot.bottom - c.plot.top;
    expect(c.costY).toBeCloseTo(c.plot.bottom - (10000 / 15000) * h, 0);
    expect(c.yTicks[0]).toMatchObject({ label: '$0', pos: c.plot.bottom });
    expect(c.xTicks.map((t) => t.label)).toEqual(['0', '1', '2', '3', '4']);
  });

  it('marks the crossing at the engine likely payback and puts it on the cost line', () => {
    const c = buildSavingsChart(src({ analysisYears: 10, yearlySavings: Array(10).fill(2000), yearlySavingsLow: Array(10).fill(1000), yearlySavingsHigh: Array(10).fill(3000) }))!;
    expect(c.crossing).toMatchObject({ years: 5, label: 'Pays back ~year 5' });
    expect(c.crossing!.y).toBe(c.costY);
    expect(c.crossing!.x).toBeCloseTo(46 + 0.5 * (CHART_W - 12 - 46), 0);
  });

  it('half-year payback keeps its decimal; no crossing when never paid back', () => {
    const half = buildSavingsChart(src({ paybackYears: { low: 4, likely: 3.5, high: 4 } }))!;
    expect(half.crossing?.label).toBe('Pays back ~year 3.5');
    const never = buildSavingsChart(src({ paybackYears: { low: null, likely: null, high: null } }))!;
    expect(never.crossing).toBeNull();
    expect(never.desc).toContain('do not pass the cost');
  });

  it('band polygon is closed and runs high forward then low backward', () => {
    const c = buildSavingsChart(src())!;
    expect(c.bandPath.endsWith('Z')).toBe(true);
    expect(c.bandPath.match(/L/g)).toHaveLength(9);
  });

  it('returns null for inconsistent or empty input', () => {
    expect(buildSavingsChart(src({ yearlySavings: [1, 2] }))).toBeNull();
    expect(buildSavingsChart(src({ yearlySavingsHigh: [0, 0, 0, 0], yearlySavings: [0, 0, 0, 0], yearlySavingsLow: [0, 0, 0, 0] }))).toBeNull();
  });
});
