import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calcPath, cityPath, legacyCityPath, taxPath, usRedirects, utilityPath } from './paths';

describe('US path helpers', () => {
  it('builds the /us/ URLs', () => {
    expect(calcPath('FL')).toBe('/us/solar-payback/florida');
    expect(calcPath('california')).toBe('/us/solar-payback/california');
    expect(cityPath('CA', 'san-diego')).toBe('/us/solar-payback/california/san-diego');
    expect(utilityPath('FL', 'fpl')).toBe('/us/utility/florida/fpl');
    expect(taxPath()).toBe('/us/solar-tax-benefits');
    expect(taxPath('FL')).toBe('/us/solar-tax-benefits/florida');
    expect(legacyCityPath('FL', 'miami')).toBe('/solar/florida/miami');
  });

  it('maps every old path to one new path, with no chains', () => {
    const map = usRedirects([{ state: 'FL', slug: 'fpl' }, { state: 'CA', slug: 'pge' }]);
    expect(map).toEqual({
      '/calculator/florida': '/us/solar-payback/florida',
      '/solar-tax-benefits/florida': '/us/solar-tax-benefits/florida',
      '/calculator/california': '/us/solar-payback/california',
      '/solar-tax-benefits/california': '/us/solar-tax-benefits/california',
      '/solar-tax-benefits': '/us/solar-tax-benefits',
      '/solar/florida/fpl': '/us/utility/florida/fpl',
      '/solar/california/pge': '/us/utility/california/pge',
    });
    for (const to of Object.values(map)) expect(map[to]).toBeUndefined();
  });
});

describe('no internal link relies on a redirect', () => {
  it('src has no pre-/us/ US path outside the redirect helpers and tests', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(astro|tsx?|mdx?)$/.test(n) && !/\.test\.ts$/.test(n) && !p.endsWith('lib/paths.ts')) files.push(p);
      }
    };
    walk('src');
    const legacy = /(?<![\w.-])\/(calculator\/(florida|california)|solar\/(florida|california)\/|solar-tax-benefits)/;
    expect(files.filter((f) => legacy.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
});
