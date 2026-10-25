import { describe, expect, it } from 'vitest';
import { trustedFormCsp, trustedFormEnabled, trustedFormScriptUrl } from './consent-vendor';

describe('consent vendor', () => {
  it('is off unless explicitly "true"', () => {
    for (const v of [undefined, '', 'false', '1', 'yes', null]) expect(trustedFormEnabled(v), String(v)).toBe(false);
    expect(trustedFormEnabled('true')).toBe(true);
  });
  it('adds no CSP origins when off, only TrustedForm origins when on', () => {
    expect(trustedFormCsp(false)).toEqual({ script: [], connect: [], img: [] });
    expect(trustedFormCsp(true).script).toEqual(['https://api.trustedform.com']);
  });
  it('script URL names the field the server reads', () => {
    expect(trustedFormScriptUrl(1)).toBe('https://api.trustedform.com/trustedform.js?field=trustedform_cert_url&l=1');
  });
});
