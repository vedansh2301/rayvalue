import { describe, expect, it } from 'vitest';
import { adCspSources, anyAdTagEnabled, parseAdConversions, parseAdIds } from './config';

describe('ad tag config', () => {
  it('is fully off by default and adds no CSP origins', () => {
    const ids = parseAdIds({});
    expect(ids).toEqual({ ga4: null, googleAds: null, metaPixel: null });
    expect(anyAdTagEnabled(ids)).toBe(false);
    expect(adCspSources(ids)).toEqual({ script: [], connect: [], img: [] });
  });
  it('rejects malformed IDs', () => {
    expect(parseAdIds({ PUBLIC_GA4_ID: 'UA-1', PUBLIC_GOOGLE_ADS_ID: 'x', PUBLIC_META_PIXEL_ID: 'abc' })).toEqual({ ga4: null, googleAds: null, metaPixel: null });
    expect(parseAdIds({ PUBLIC_GA4_ID: '"><script>' }).ga4).toBeNull();
  });
  it('accepts well-formed IDs and opens only the matching origins', () => {
    const g = parseAdIds({ PUBLIC_GA4_ID: ' G-ABC123XYZ9 ' });
    expect(g.ga4).toBe('G-ABC123XYZ9');
    expect(adCspSources(g).script).toEqual(['https://www.googletagmanager.com']);
    const m = parseAdIds({ PUBLIC_META_PIXEL_ID: '123456789012345' });
    expect(adCspSources(m).script).toEqual(['https://connect.facebook.net']);
    expect(adCspSources(m).connect).not.toContain('https://www.googletagmanager.com');
  });
});

describe('Google Ads conversion labels', () => {
  it('are null by default and reject malformed values', () => {
    expect(parseAdConversions({})).toEqual({ calc_complete: null, quote_submit: null });
    expect(parseAdConversions({ PUBLIC_GOOGLE_ADS_QUOTE_LABEL: '"><script>' }).quote_submit).toBeNull();
  });
  it('accept AW-id/label send_to values', () => {
    expect(parseAdConversions({ PUBLIC_GOOGLE_ADS_QUOTE_LABEL: 'AW-123456789/AbCdEf12', PUBLIC_GOOGLE_ADS_CALC_LABEL: 'AW-123456789/ZyXwVu34' })).toEqual({
      calc_complete: 'AW-123456789/ZyXwVu34',
      quote_submit: 'AW-123456789/AbCdEf12',
    });
  });
});
