import { describe, expect, it } from 'vitest';
import { cityDescription, cityTitle, DESC_MAX, DESC_MIN, TITLE_MAX, type CityMetaInput } from './meta';

const NAMES = ['Ocala', 'Miami', 'Port St. Lucie', 'Palm Beach Gardens', 'Rancho Santa Margarita', 'Fort Lauderdale', 'Chula Vista'];
const base = (name: string): CityMetaInput => ({
  name, state: 'FL', stateName: 'Florida', utilityShort: 'FPL',
  example: { bill: 150, low: 7.5, likely: 9, high: 11.5, analysisYears: 25 },
  annualKwhPerKw: 1523.6,
});

const digitRuns = (s: string) => s.match(/\d+(\.\d+)?/g) ?? [];

describe('cityTitle', () => {
  it.each(NAMES)('%s: full title <= 60 chars', (n) => {
    const t = cityTitle({ name: n, state: 'FL' });
    expect(t.length + ' | RayValue'.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(t).toContain(n);
  });
  it('prefers the longest template that fits', () => {
    expect(cityTitle({ name: 'Ocala', state: 'FL' })).toBe('Solar payback in Ocala, FL: 2026, no tax credit');
  });
});

describe('cityDescription', () => {
  it.each(NAMES)('%s: 140-155 chars on every path', (n) => {
    const variants: CityMetaInput[] = [
      base(n),
      { ...base(n), example: null },
      { ...base(n), example: null, annualKwhPerKw: null },
      { ...base(n), example: { bill: 150, low: 30, likely: null, high: null, analysisYears: 25 } },
      { ...base(n), utilityShort: null },
    ];
    for (const v of variants) {
      const d = cityDescription(v);
      expect(d.length, d).toBeGreaterThanOrEqual(DESC_MIN);
      expect(d.length, d).toBeLessThanOrEqual(DESC_MAX);
    }
  });

  it('every digit run comes from the input (plus the page year)', () => {
    for (const n of NAMES) {
      const v = base(n);
      const allowed = new Set(['2026', '7.5', '9', '11.5', '150', '1,524', '1', '524', '25']);
      for (const input of [v, { ...v, example: null }, { ...v, example: { bill: 150, low: 30, likely: null, high: null, analysisYears: 25 } }]) {
        for (const run of digitRuns(cityDescription(input))) expect(allowed.has(run), `${run} in ${cityDescription(input)}`).toBe(true);
      }
    }
  });

  it('uses the payback sentence with "example" when there is a bill', () => {
    const d = cityDescription(base('Miami'));
    expect(d).toContain('7.5–11.5 years (likely 9)');
    expect(d).toContain('example $150/month bill');
  });
  it('says "more than N" when payback is beyond the analysis period', () => {
    expect(cityDescription({ ...base('Miami'), example: { bill: 150, low: null, likely: null, high: null, analysisYears: 25 } })).toContain('more than 25 years');
  });
  it('falls to the sun sentence with no payback, then to the generic line with no production', () => {
    expect(cityDescription({ ...base('Miami'), example: null })).toContain('kWh per kW');
    const g = cityDescription({ ...base('Miami'), example: null, annualKwhPerKw: null });
    expect(g).not.toMatch(/kWh/);
    expect(g).toContain('Miami, Florida');
  });
});
