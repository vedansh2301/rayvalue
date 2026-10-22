import { describe, expect, it } from 'vitest';
import { CONSENT_LEAD, CONSENT_TEXT, CONSENT_VERSION } from './consent';
import { cleanPath, normalizePhone, parseSnapshot, validateDataRequest, validateLead } from './validate';

const good = {
  first_name: '  Ana  ',
  email: ' Ana@Example.COM ',
  phone: '(305) 555-0123',
  zip: '33101',
  homeowner: 'yes',
  timeline: 'asap',
  consent: 'on',
  source: 'results',
  page_path: '/calculator/florida?zip=33101&bill=200',
};

describe('consent constant', () => {
  it('is the spec text and version', () => {
    expect(CONSENT_VERSION).toBe('2026-10-22.1');
    expect(CONSENT_LEAD).toMatch(/^By submitting, you agree that RayValue and up to 3 solar installers serving your area may contact you by phone \(including calls and texts using automated technology\), text or email about solar quotes\. Consent is not a condition of purchase\. Message and data rates may apply\. You can opt out at any time\.$/);
    expect(CONSENT_TEXT.startsWith(CONSENT_LEAD)).toBe(true);
    expect(CONSENT_TEXT).toContain('Privacy Policy');
  });
});

describe('normalizePhone', () => {
  it('normalizes US numbers to E.164', () => {
    for (const p of ['3055550123', '305-555-0123', '(305) 555-0123', '+1 305 555 0123', '1-305-555-0123', '305.555.0123']) {
      expect(normalizePhone(p), p).toBe('+13055550123');
    }
  });
  it('rejects non-NANP and junk', () => {
    for (const p of ['', '555-0123', '105-555-0123', '305-155-0123', '2-305-555-0123', '30555501234', '305555012', 'call me', '305-555-0123 ext 4', 42, null, '1'.repeat(41)]) {
      expect(normalizePhone(p as string), String(p)).toBeNull();
    }
  });
});

describe('validateLead', () => {
  it('normalizes a valid lead and derives state from the ZIP', () => {
    const v = validateLead(good);
    expect(v.kind).toBe('ok');
    if (v.kind !== 'ok') return;
    expect(v.lead).toMatchObject({ first_name: 'Ana', email: 'ana@example.com', phone: '+13055550123', zip: '33101', state: 'FL', homeowner: true, timeline: 'asap', source: 'results', page_path: '/calculator/florida' });
    expect(v.lead).toMatchObject({ utility_id: null, avg_monthly_bill: null, battery: null, shading: null, estimate_snapshot: null });
  });
  it('requires the chosen state to match the ZIP', () => {
    expect(validateLead({ ...good, state: 'FL' }).kind).toBe('ok');
    const v = validateLead({ ...good, state: 'CA' });
    expect(v.kind === 'invalid' && v.fieldErrors.zip).toMatch(/Florida/);
    expect(validateLead({ ...good, zip: '90210' }).kind === 'ok').toBe(true);
    const tx = validateLead({ ...good, zip: '75001' });
    expect(tx.kind === 'invalid' && tx.fieldErrors.zip).toMatch(/Florida and California/);
    const bad = validateLead({ ...good, state: 'TX' });
    expect(bad.kind === 'invalid' && bad.fieldErrors.state).toBeTruthy();
  });
  it('reports every missing field', () => {
    const v = validateLead({});
    expect(v.kind).toBe('invalid');
    if (v.kind !== 'invalid') return;
    expect(Object.keys(v.fieldErrors).sort()).toEqual(['consent', 'email', 'first_name', 'homeowner', 'phone', 'timeline', 'zip']);
  });
  it('requires consent to be checked', () => {
    for (const consent of [undefined, '', 'off', 'false', false]) {
      const v = validateLead({ ...good, consent });
      expect(v.kind === 'invalid' && v.fieldErrors.consent, String(consent)).toBeTruthy();
    }
    expect(validateLead({ ...good, consent: true }).kind).toBe('ok');
  });
  it('allows renters (flagged false)', () => {
    const v = validateLead({ ...good, homeowner: 'no' });
    expect(v.kind === 'ok' && v.lead.homeowner).toBe(false);
  });
  it('rejects long names and bad timelines', () => {
    expect(validateLead({ ...good, first_name: 'x'.repeat(61) }).kind).toBe('invalid');
    expect(validateLead({ ...good, timeline: 'someday' }).kind).toBe('invalid');
  });
  it('honeypot wins', () => {
    expect(validateLead({ website: 'http://spam' }).kind).toBe('honeypot');
    expect(validateLead({ ...good, website: '' }).kind).toBe('ok');
  });
  it('keeps clean calculator context and drops malformed context', () => {
    const snap = { payback: { likely: '14 years', low: '11.5 years', high: '16.5 years' } };
    const v = validateLead({ ...good, utility_id: 'fpl', bill: '200', battery: '0', shading: 'none', estimate_snapshot: JSON.stringify(snap) });
    expect(v.kind === 'ok' && v.lead).toMatchObject({ utility_id: 'fpl', avg_monthly_bill: 200, battery: 0, shading: 'none', estimate_snapshot: snap });
    const w = validateLead({ ...good, utility_id: 'FPL; drop', bill: '-5', battery: '7', shading: 'dark', estimate_snapshot: '{bad', source: 'evil', page_path: 'https://x.com/' });
    expect(w.kind === 'ok' && w.lead).toMatchObject({ utility_id: null, avg_monthly_bill: null, battery: null, shading: null, estimate_snapshot: null, source: 'quotes_page', page_path: null });
  });
  it('accepts the documented sources', () => {
    for (const s of ['results', 'quotes_page', 'home', 'city:florida/miami', 'city:california/san-diego']) {
      expect(validateLead({ ...good, source: s }).kind === 'ok' && (validateLead({ ...good, source: s }) as { lead: { source: string } }).lead.source).toBe(s);
    }
  });
});

describe('parseSnapshot / cleanPath', () => {
  it('keeps only known keys with short strings', () => {
    expect(parseSnapshot({ payback: { value: 'More than 25 years' }, extra: { value: 'x' }, upfront_cost: { likely: 1 } })).toEqual({ payback: { value: 'More than 25 years' } });
    expect(parseSnapshot([])).toBeNull();
    expect(parseSnapshot({ payback: { value: 'x'.repeat(41) } })).toBeNull();
  });
  it('strips queries and rejects non-paths', () => {
    expect(cleanPath('/quotes?zip=1#a')).toBe('/quotes');
    expect(cleanPath('//evil.com')).toBeNull();
    expect(cleanPath('quotes')).toBeNull();
  });
});

describe('validateDataRequest', () => {
  it('validates email, type and details', () => {
    expect(validateDataRequest({ email: 'A@b.co', request: 'delete', details: ' ' })).toEqual({ kind: 'ok', value: { email: 'a@b.co', request: 'delete', details: null } });
    const v = validateDataRequest({ email: 'nope', request: 'sell', details: 'x'.repeat(1001) });
    expect(v.kind === 'invalid' && Object.keys(v.fieldErrors).sort()).toEqual(['details', 'email', 'request']);
    expect(validateDataRequest({ website: 'x' }).kind).toBe('honeypot');
  });
});
