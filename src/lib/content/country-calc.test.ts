import { describe, expect, it } from 'vitest';
import { countryCalculator } from './country-calc';

describe('countryCalculator', () => {
  it('the UK has one, under either its ISO code or its URL segment', () => {
    expect(countryCalculator('gb')?.href).toBe('/uk/solar-calculator');
    expect(countryCalculator('GB')?.href).toBe('/uk/solar-calculator');
    expect(countryCalculator('uk')?.cta).toBe('Run my UK numbers');
  });
  it('countries without a calculator, the US and empty values get none (so no CTA renders)', () => {
    for (const c of ['us', 'de', 'au', '', null, undefined]) expect(countryCalculator(c)).toBeNull();
  });
});
