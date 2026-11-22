import { describe, expect, it } from 'vitest';
import { COUNTRY_OUTLINES } from './country-outlines';
import { MAP_POSITIONS, MAP_VIEWBOX, mapShape, mapXY } from './country-map';
import { REGION_BY_SEGMENT } from '../home/global-home';

describe('country map', () => {
  it('has a position and outline for every country the site groups by region', () => {
    for (const seg of Object.keys(REGION_BY_SEGMENT)) {
      expect(MAP_POSITIONS[seg], seg).toBeDefined();
      expect(COUNTRY_OUTLINES[seg], seg).toBeDefined();
    }
  });
  it('projects lon/lat linearly onto the 1000x470 box', () => {
    expect(mapXY(-170, 78)).toEqual([0, 0]);
    expect(mapXY(190, -60)).toEqual([MAP_VIEWBOX.w, MAP_VIEWBOX.h]);
  });
  it('keeps every shape centre inside the map', () => {
    for (const seg of Object.keys(MAP_POSITIONS)) {
      const s = mapShape(seg)!;
      expect(s.cx).toBeGreaterThan(0);
      expect(s.cx).toBeLessThan(MAP_VIEWBOX.w);
      expect(s.cy).toBeGreaterThan(0);
      expect(s.cy).toBeLessThan(MAP_VIEWBOX.h);
    }
  });
  it('returns null for an unknown segment', () => {
    expect(mapShape('xx')).toBeNull();
  });
});
