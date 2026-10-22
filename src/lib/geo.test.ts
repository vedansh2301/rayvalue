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
  it('maps a Miami ZIP to Miami', () => {
    const z = lookupZip('33130')!;
    expect(nearestCity(z.lat, z.lon, z.state)?.slug).toBe('miami');
  });
  it('maps a San Diego ZIP to San Diego', () => {
    const z = lookupZip('92101')!;
    expect(nearestCity(z.lat, z.lon, z.state)?.slug).toBe('san-diego');
  });
  it('only returns cities in the requested state', () => {
    // Point in Miami but asking for California returns a California city.
    expect(nearestCity(25.77, -80.2, 'CA')?.state).toBe('CA');
  });
  it('picks the closer of two nearby cities', () => {
    // Just north of Tampa downtown
    expect(nearestCity(27.96, -82.46, 'FL')?.slug).toBe('tampa');
  });
});
