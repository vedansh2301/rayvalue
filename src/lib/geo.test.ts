import { describe, expect, it } from 'vitest';
import { haversineKm, lookupZip, nearestCity } from './geo';

describe('lookupZip', () => {
  it('finds a Florida ZIP', () => {
    const r = lookupZip('33101');
    expect(r?.state).toBe('FL');
    expect(r!.lat).toBeCloseTo(25.78, 1);
    expect(r!.lon).toBeCloseTo(-80.2, 1);
  });
  it('finds a California ZIP', () => {
    const r = lookupZip('94103');
    expect(r?.state).toBe('CA');
    expect(r!.lat).toBeCloseTo(37.77, 1);
  });
  it('trims whitespace', () => {
    expect(lookupZip(' 33101 ')?.state).toBe('FL');
  });
  it('rejects malformed input', () => {
    for (const bad of ['', '1234', '123456', 'abcde', '3310a', '33101-1234', '331 01']) {
      expect(lookupZip(bad)).toBeNull();
    }
  });
  it('returns null for out-of-state and unknown ZIPs', () => {
    expect(lookupZip('10001')).toBeNull(); // New York
    expect(lookupZip('78701')).toBeNull(); // Texas
    expect(lookupZip('99999')).toBeNull();
    expect(lookupZip('00000')).toBeNull();
  });
});

describe('haversineKm', () => {
  it('is zero for identical points', () => {
    expect(haversineKm(25.77, -80.2, 25.77, -80.2)).toBe(0);
  });
  it('matches a known distance (Miami to Orlando is about 330 km)', () => {
    expect(haversineKm(25.7617, -80.1918, 28.5384, -81.3789)).toBeGreaterThan(320);
    expect(haversineKm(25.7617, -80.1918, 28.5384, -81.3789)).toBeLessThan(345);
  });
  it('is symmetric', () => {
    const a = haversineKm(37.77, -122.41, 32.71, -117.17);
    const b = haversineKm(32.71, -117.17, 37.77, -122.41);
    expect(a).toBeCloseTo(b, 9);
  });
});

describe('nearestCity', () => {
  // Synthetic points (test-only), not the real city list (that lives in the database).
  const CITIES = [
    { slug: 'fx-south', state: 'FL', lat: 25.77, lon: -80.2 },
    { slug: 'fx-west', state: 'FL', lat: 27.95, lon: -82.46 },
    { slug: 'fx-west-2', state: 'FL', lat: 27.91, lon: -82.3 },
    { slug: 'fx-ca-south', state: 'CA', lat: 32.71, lon: -117.17 },
    { slug: 'fx-ca-north', state: 'CA', lat: 37.77, lon: -122.41 },
  ] as const;

  it('maps a ZIP to the closest point in its state', () => {
    const z = lookupZip('33130')!;
    expect(nearestCity(z.lat, z.lon, z.state, CITIES)?.slug).toBe('fx-south');
    const sd = lookupZip('92101')!;
    expect(nearestCity(sd.lat, sd.lon, sd.state, CITIES)?.slug).toBe('fx-ca-south');
  });
  it('only returns cities in the requested state', () => {
    expect(nearestCity(25.77, -80.2, 'CA', CITIES)?.state).toBe('CA');
  });
  it('picks the closer of two nearby cities', () => {
    expect(nearestCity(27.96, -82.46, 'FL', CITIES)?.slug).toBe('fx-west');
    expect(nearestCity(27.9, -82.29, 'FL', CITIES)?.slug).toBe('fx-west-2');
  });
  it('returns null for an empty list or a state with no cities', () => {
    expect(nearestCity(25.77, -80.2, 'FL', [])).toBeNull();
    expect(nearestCity(25.77, -80.2, 'CA', CITIES.filter((c) => c.state === 'FL'))).toBeNull();
  });
});
