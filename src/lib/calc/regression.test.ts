/**
 * Regression: the US (FL tiered net metering, CA net billing) results must be IDENTICAL to the pre-global engine.
 * src/lib/calc/__golden__/legacy-results.json was generated from the engine at commit 0a3e663 (before the
 * export-policy / incentive refactor) over 240 combinations: every synthetic fixture utility x 5 bills x 3 battery
 * counts x 2 shadings x 2 production levels. Numbers are compared exactly; the assumptions text and the three
 * yearly series are compared by hash. If this test fails, the live FL/CA pages' numbers would have changed.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lookupZip } from '../geo';
import { calculate } from './calculate';
import { CA_ZIP, FL_ZIP, fixtureAssumptions, fixtureCosts, fixtureUtilities } from './test-fixtures';

const golden = JSON.parse(readFileSync(new URL('./__golden__/legacy-results.json', import.meta.url), 'utf8')) as Record<string, Record<string, unknown>>;
const sha = (x: unknown) => createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 12);
const SHAPE = [90, 100, 120, 135, 150, 155, 150, 145, 125, 110, 90, 80];

describe('US results are unchanged by the global engine', () => {
  it('golden file has the expected size', () => {
    expect(Object.keys(golden)).toHaveLength(4 * 5 * 3 * 2 * 2);
  });

  for (const [key, expected] of Object.entries(golden)) {
    it(key, () => {
      const [id, , bill, battery, shading, kwh] = key.split('|') as [string, string, string, string, string, string];
      const u = fixtureUtilities.find((x) => x.id === id && key.includes(x.name))!;
      const r = calculate(
        { zip: u.state === 'FL' ? FL_ZIP : CA_ZIP, utilityId: u.id, avgMonthlyBill: Number(bill), battery: Number(battery) as 0 | 1 | 2, shading: shading as 'none' | 'heavy' },
        {
          lookupZip,
          utilities: fixtureUtilities,
          costs: fixtureCosts,
          assumptions: fixtureAssumptions,
          production: { annualKwhPerKw: Number(kwh), monthlyKwhPerKw: SHAPE.map((v) => (v * Number(kwh)) / 1450) },
        },
      );
      if (!r.ok) return expect(r).toEqual(expected);
      const { assumptions, yearlySavings, yearlySavingsLow, yearlySavingsHigh, warnings, ...numbers } = r;
      const { assumptionsSha, savingsSha, warnings: goldenWarnings, ...goldenNumbers } = expected as Record<string, unknown>;
      expect(numbers).toEqual(goldenNumbers);
      expect(warnings).toEqual(goldenWarnings);
      expect(sha(assumptions)).toBe(assumptionsSha);
      expect(sha([yearlySavings, yearlySavingsLow, yearlySavingsHigh])).toBe(savingsSha);
    });
  }
});
