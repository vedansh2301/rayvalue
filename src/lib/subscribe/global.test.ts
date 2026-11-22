import { describe, expect, it } from 'vitest';
import { consentSentence, signupText } from '../i18n/signup';
import { isValidRegion, normalizeCountry, parsePayload, parseTopics, reportUrl, validateGlobalSignup } from './global';

const base = { email: 'Name@Example.com ', country: 'gb', topics: ['report'], consent: true, source: 'uk-calculator' };

describe('validateGlobalSignup', () => {
  it('accepts a valid signup and normalises it', () => {
    const v = validateGlobalSignup(base);
    expect(v).toEqual({ kind: 'ok', value: { email: 'name@example.com', country: 'GB', region: null, topics: ['report'], locale: 'en', source: 'uk-calculator', params: null } });
  });
  it('allows only US, GB, DE, AU (UK is an alias of GB)', () => {
    expect(normalizeCountry('UK')).toBe('GB');
    for (const c of ['US', 'gb', 'De', 'au']) expect(normalizeCountry(c)).not.toBeNull();
    for (const c of ['FR', 'CA', 'IN', '', 'USA', undefined, 5]) expect(normalizeCountry(c), String(c)).toBeNull();
    expect(validateGlobalSignup({ ...base, country: 'FR' })).toMatchObject({ kind: 'invalid', field: 'country' });
  });
  it('requires consent to be true (checkbox values count, absence and false do not)', () => {
    for (const consent of [undefined, false, 'false', '', 0, 'no']) expect(validateGlobalSignup({ ...base, consent }), String(consent)).toMatchObject({ kind: 'invalid', field: 'consent' });
    for (const consent of [true, 'on', 'true', 'yes']) expect(validateGlobalSignup({ ...base, consent }).kind).toBe('ok');
  });
  it('rejects bad emails', () => {
    for (const email of ['', 'nope', 'a@b', 'a b@c.com', '@c.com', 'x'.repeat(250) + '@a.com', 42, undefined]) expect(validateGlobalSignup({ ...base, email }), String(email)).toMatchObject({ kind: 'invalid', field: 'email' });
  });
  it('honeypot wins over everything', () => {
    expect(validateGlobalSignup({ email: 'bad', website: 'http://spam' }).kind).toBe('honeypot');
  });
  it('German locale defaults for DE and can be chosen; unknown locales fall back', () => {
    expect(validateGlobalSignup({ ...base, country: 'DE' })).toMatchObject({ value: { locale: 'de' } });
    expect(validateGlobalSignup({ ...base, country: 'GB', locale: 'de' })).toMatchObject({ value: { locale: 'de' } });
    expect(validateGlobalSignup({ ...base, country: 'DE', locale: 'fr' })).toMatchObject({ value: { locale: 'de' } });
  });
  it('rejects an unsafe source', () => {
    expect(validateGlobalSignup({ ...base, source: '<script>' })).toMatchObject({ kind: 'invalid', field: 'source' });
  });
});

describe('region validation', () => {
  it('US: a state code, any of the 50 states and DC, not FL-or-CA only', () => {
    for (const r of ['TX', 'NY', 'DC', 'FL', 'CA']) expect(isValidRegion('US', r), r).toBe(true);
    for (const r of ['ZZ', 'Texas', 'PR', '']) expect(isValidRegion('US', r), r).toBe(false);
    expect(validateGlobalSignup({ ...base, country: 'US', region: 'tx' })).toMatchObject({ value: { region: 'TX' } });
  });
  it('GB, DE, AU: the calculator id with its own country prefix', () => {
    expect(isValidRegion('GB', 'gb-cap-london')).toBe(true);
    expect(isValidRegion('DE', 'de-hamburg')).toBe(true);
    expect(isValidRegion('AU', 'au-ausgrid')).toBe(true);
    expect(isValidRegion('DE', 'gb-cap-london')).toBe(false);
    expect(isValidRegion('GB', 'gb-')).toBe(false);
    expect(isValidRegion('AU', "au-x'; drop table")).toBe(false);
    expect(isValidRegion('AU', 'au-' + 'a'.repeat(70))).toBe(false);
  });
  it('an invalid region rejects the signup; an empty one is fine', () => {
    expect(validateGlobalSignup({ ...base, region: 'de-hamburg' })).toMatchObject({ kind: 'invalid', field: 'region' });
    expect(validateGlobalSignup({ ...base, region: '' }).kind).toBe('ok');
  });
});

describe('topics', () => {
  it('accepts report, deadline_alerts or both (array or comma string), deduplicated', () => {
    expect(parseTopics(['report', 'deadline_alerts'])).toEqual(['report', 'deadline_alerts']);
    expect(parseTopics('deadline_alerts')).toEqual(['deadline_alerts']);
    expect(parseTopics(['report', 'report'])).toEqual(['report']);
  });
  it('rejects none, unknown topics and non-lists', () => {
    for (const t of [[], ['marketing'], ['report', 'x'], undefined, null, 5, '']) expect(parseTopics(t), String(t)).toBeNull();
    expect(validateGlobalSignup({ ...base, topics: ['quotes'] })).toMatchObject({ kind: 'invalid', field: 'topics' });
  });
});

describe('payload (reopen-my-estimate parameters)', () => {
  it('keeps only allow-listed parameters with safe values', () => {
    expect(parsePayload({ params: { region: 'gb-cap-london', bill: 120, battery: '1', install: '2027-01-01' } })).toEqual({ region: 'gb-cap-london', bill: '120', battery: '1', install: '2027-01-01' });
  });
  it('rejects unknown keys and unsafe values outright', () => {
    expect(parsePayload({ params: { payback: '9' } })).toBe('invalid');
    expect(parsePayload({ params: { bill: '1&x=2' } })).toBe('invalid');
    expect(parsePayload({ params: { bill: 'https://evil.example' } })).toBe('invalid');
    expect(parsePayload('x')).toBe('invalid');
    expect(parsePayload([1])).toBe('invalid');
  });
  it('no payload is fine; params are dropped unless the report topic is chosen', () => {
    expect(parsePayload(undefined)).toBeNull();
    const payload = { params: { bill: '90' } };
    expect(validateGlobalSignup({ ...base, payload })).toMatchObject({ value: { params: { bill: '90' } } });
    expect(validateGlobalSignup({ ...base, topics: ['deadline_alerts'], payload })).toMatchObject({ value: { params: null } });
    expect(validateGlobalSignup({ ...base, payload: { params: { nope: '1' } } })).toMatchObject({ kind: 'invalid', field: 'payload' });
  });
});

describe('reportUrl', () => {
  it('links to the country calculator with only the allow-listed answers, in a fixed order', () => {
    expect(reportUrl('https://rayvalue.com/', 'GB', { bill: '90', region: 'gb-cap-london' })).toBe('https://rayvalue.com/uk/solar-calculator?region=gb-cap-london&bill=90');
    expect(reportUrl('https://rayvalue.com', 'DE', null)).toBe('https://rayvalue.com/de/photovoltaik-rechner');
    expect(reportUrl('https://rayvalue.com', 'AU', { shade: 'some' })).toBe('https://rayvalue.com/au/solar-battery-calculator?shade=some');
  });
  it('countries without a calculator link to their guides', () => {
    expect(reportUrl('https://rayvalue.com', 'US', { bill: '90' })).toBe('https://rayvalue.com/us');
  });
});

describe('consent wording', () => {
  it('names the country, offers unsubscribe, links the privacy policy; never promises quotes', () => {
    const t = consentSentence('en', 'GB', ['report', 'deadline_alerts']);
    expect(t).toBe('Email me my payback report and alerts when a deadline or rate change affects solar in the United Kingdom. Unsubscribe any time. See our Privacy Policy.');
    expect(consentSentence('en', 'US', ['deadline_alerts'])).toContain('alerts when a deadline or rate change affects solar in the United States');
    for (const c of ['US', 'GB', 'DE', 'AU'] as const) for (const l of ['en', 'de']) expect(consentSentence(l, c, ['report', 'deadline_alerts']).toLowerCase()).not.toMatch(/quote|angebot/);
  });
  it('German texts come from the German dictionary', () => {
    expect(consentSentence('de', 'DE', ['report', 'deadline_alerts'])).toContain('Deutschland');
    expect(signupText('de-DE').consent('DE', ['report']).link).toBe('Datenschutzerklärung');
    expect(signupText('en-GB').buttons.report).toBe('Email me this estimate');
  });
});
