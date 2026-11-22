import { describe, expect, it } from 'vitest';
import { countryCalculator } from './country-calc';

describe('countryCalculator', () => {
  it('the UK has one, under either its ISO code or its URL segment', () => {
    expect(countryCalculator('gb')?.href).toBe('/uk/solar-calculator');
    expect(countryCalculator('GB')?.href).toBe('/uk/solar-calculator');
    expect(countryCalculator('uk')?.cta).toBe('Run my UK numbers');
  });
  it('countries without a calculator, the US and empty values get none (so no CTA renders)', () => {
    for (const c of ['us', 'fr', 'jp', '', null, undefined]) expect(countryCalculator(c)).toBeNull();
  });
});

describe('launched calculators', () => {
  it('Germany and Australia have their own calculator', () => {
    expect(countryCalculator('de')?.href).toBe('/de/photovoltaik-rechner');
    expect(countryCalculator('AU')?.href).toBe('/au/solar-battery-calculator');
  });
});
