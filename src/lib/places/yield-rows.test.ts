import { describe, expect, it } from 'vitest';
import { coordsFromPvgisUrl, parseWktPoint, parseYieldNote, yieldFactRows, yieldNote } from './yield-rows';
import { buildUpstreamUrl } from '../server/pvgis';

const r = { annualKwhPerKw: 1559.5, monthlyKwhPerKw: Array.from({ length: 12 }, (_, i) => 100 + i), dataset: 'PVGIS-ERA5', tiltDeg: 34, compassAzimuthDeg: 1 };

describe('yield rows', () => {
  it('writes 1 annual + 12 monthly rows with the exact PVGIS URL as source', () => {
    const url = buildUpstreamUrl({ country: 'AU', lat: '-33.87', lon: '151.21', losses: 14 }).toString();
    const rows = yieldFactRows('nsw/sydney', url, r, 14, '2026-11-22');
    expect(rows).toHaveLength(13);
    expect(rows[0]).toMatchObject({ key: 'solar_yield_kwh_per_kwp', region: 'nsw/sydney', value: '1559.5', source_url: url, publisher: 'EU JRC PVGIS 5.3', retrieved_on: '2026-11-22' });
    expect(rows[1]).toMatchObject({ key: 'solar_yield_monthly_kwh_per_kwp', unit: 'kWh/kWp (month 1)' });
    expect(rows[12]!.unit).toBe('kWh/kWp (month 12)');
  });

  it('southern-hemisphere requests face north (aspect 180), northern face south (aspect 0), as the proxy does', () => {
    expect(buildUpstreamUrl({ country: 'AU', lat: '-33.87', lon: '151.21', losses: 14 }).searchParams.get('aspect')).toBe('180');
    expect(buildUpstreamUrl({ country: 'GB', lat: '54.97', lon: '-1.61', losses: 14 }).searchParams.get('aspect')).toBe('0');
    expect(buildUpstreamUrl({ country: 'AU', lat: '-33.87', lon: '151.21', losses: 14 }).searchParams.get('optimalinclination')).toBe('1');
  });

  it('round-trips the method note', () => {
    expect(yieldNote(r, 14)).toBe('db=PVGIS-ERA5;tilt=34;azimuth=1;loss=14');
    expect(parseYieldNote(yieldNote(r, 14))).toEqual({ db: 'PVGIS-ERA5', tilt: 34, azimuth: 1, loss: 14 });
    expect(parseYieldNote(null)).toBeNull();
    expect(parseYieldNote('junk')).toBeNull();
  });
});

describe('coordinate helpers', () => {
  it('parses Wikidata WKT points (lon lat) and PVGIS URLs', () => {
    expect(parseWktPoint('Point(11.575 48.1375)')).toEqual({ lat: 48.1375, lon: 11.575 });
    expect(parseWktPoint('Point(6.957777777 50.942222222)')).toEqual({ lat: 50.9422, lon: 6.9578 });
    expect(parseWktPoint('POINT(200 10)')).toBeNull();
    expect(parseWktPoint('nonsense')).toBeNull();
    expect(coordsFromPvgisUrl('https://re.jrc.ec.europa.eu/api/v5_3/PVcalc?lat=54.9739&lon=-1.6133&peakpower=1')).toEqual({ lat: 54.9739, lon: -1.6133 });
    expect(coordsFromPvgisUrl('https://x.org')).toBeNull();
  });
});
