import { describe, expect, it } from 'vitest';
import { cleanPath, normalizePhone, parseSnapshot, stepOfField, validateContact, validateDataRequest, validateHome, validateLead, validateProject } from './validate';

export const good = {
  zip: '33101',
  street_address: ' 123  Palm Ave ',
  homeowner: 'yes',
  bill_bucket: '150_200',
  utility_id: 'fpl',
  shading: 'some',
  roof_age: '10_20',
  battery_interest: 'unsure',
  pay_method: 'loan',
  timeline: 'asap',
  first_name: '  Ana  ',
  last_name: ' Diaz ',
  email: ' Ana@Example.COM ',
  phone: '(305) 201-0123',
  consent: 'on',
  source: 'results',
  page_path: '/calculator/florida?zip=33101&bill=200',
};

describe('normalizePhone', () => {
  it('normalizes US numbers to E.164', () => {
    for (const p of ['3052010123', '305-201-0123', '(305) 201-0123', '+1 305 201 0123', '1-305-201-0123', '305.201.0123']) {
      expect(normalizePhone(p), p).toBe('+13052010123');
    }
  });
  it('rejects N11 area codes and exchanges', () => {
    for (const p of ['911-201-0123', '411-201-0123', '211-201-0123', '305-911-0123', '305-411-0123']) expect(normalizePhone(p), p).toBeNull();
    expect(normalizePhone('305-511-0123')).toBeNull();
    expect(normalizePhone('305-512-0123')).toBe('+13055120123');
  });
  it('rejects repeated digits', () => {
    for (const p of ['222-222-2222', '999-999-9999', '305-777-7777', '3057777777']) expect(normalizePhone(p), p).toBeNull();
    expect(normalizePhone('305-777-7778')).toBe('+13057777778');
  });
  it('rejects 555 area codes and exchanges', () => {
    for (const p of ['305-555-0123', '555-201-0123', '(555) 234-5678', '1-305-555-1212']) expect(normalizePhone(p), p).toBeNull();
  });
  it('rejects non-NANP and junk', () => {
    for (const p of ['', '555-0123', '105-201-0123', '305-155-0123', '2-305-201-0123', '30520101234', '305201012', 'call me', '305-201-0123 ext 4', 42, null, '1'.repeat(41)]) {
      expect(normalizePhone(p as string), String(p)).toBeNull();
    }
  });
});

describe('validateHome', () => {
  it('accepts a complete step, trims and collapses the address, maps "other" utility to null', () => {
    const h = validateHome(good);
    expect(h.errors).toEqual({});
    expect(h.value).toEqual({ zip: '33101', state: 'FL', street_address: '123 Palm Ave', homeowner: true, bill_bucket: '150_200', utility_id: 'fpl' });
    expect(validateHome({ ...good, utility_id: 'other' }).value?.utility_id).toBeNull();
  });
  it('requires every field', () => {
    const h = validateHome({});
    expect(Object.keys(h.errors).sort()).toEqual(['bill_bucket', 'homeowner', 'street_address', 'utility_id', 'zip']);
  });
  it('validates the ZIP against FL and CA and an optional chosen state', () => {
    expect(validateHome({ ...good, state: 'FL' }).value?.state).toBe('FL');
    expect(validateHome({ ...good, state: 'CA' }).errors.zip).toMatch(/Florida/);
    expect(validateHome({ ...good, zip: '90210' }).value?.state).toBe('CA');
    expect(validateHome({ ...good, zip: '75001' }).errors.zip).toMatch(/Florida and California/);
    expect(validateHome({ ...good, zip: '3310' }).errors.zip).toMatch(/5-digit/);
    expect(validateHome({ ...good, state: 'TX' }).errors.state).toBeTruthy();
  });
  it('rejects unknown bill buckets and malformed utility ids', () => {
    expect(validateHome({ ...good, bill_bucket: '999' }).errors.bill_bucket).toBeTruthy();
    expect(validateHome({ ...good, utility_id: 'FPL; drop' }).errors.utility_id).toBeTruthy();
  });
  it('lets a renter through this step (the caller shows the message)', () => {
    const h = validateHome({ ...good, homeowner: 'no' });
    expect(h.value?.homeowner).toBe(false);
  });
});

describe('validateProject', () => {
  it('accepts every documented option', () => {
    for (const shading of ['none', 'some', 'heavy', 'unsure']) expect(validateProject({ ...good, shading }).errors.shading).toBeUndefined();
    for (const roof_age of ['under_10', '10_20', '20_plus', 'unsure']) expect(validateProject({ ...good, roof_age }).errors.roof_age).toBeUndefined();
    for (const battery_interest of ['yes', 'no', 'unsure']) expect(validateProject({ ...good, battery_interest }).errors.battery_interest).toBeUndefined();
    for (const pay_method of ['cash', 'loan', 'lease_ppa', 'unsure']) expect(validateProject({ ...good, pay_method }).errors.pay_method).toBeUndefined();
    for (const timeline of ['asap', '1_3_months', '3_6_months', 'researching']) expect(validateProject({ ...good, timeline }).errors.timeline).toBeUndefined();
  });
  it('requires all five and rejects unknown values', () => {
    expect(Object.keys(validateProject({}).errors).sort()).toEqual(['battery_interest', 'pay_method', 'roof_age', 'shading', 'timeline']);
    expect(validateProject({ ...good, timeline: 'someday' }).errors.timeline).toBeTruthy();
  });
});

describe('validateContact', () => {
  it('trims, lowercases the email and normalizes the phone', () => {
    expect(validateContact(good).value).toEqual({ first_name: 'Ana', last_name: 'Diaz', email: 'ana@example.com', phone: '+13052010123' });
  });
  it('checks email format, phone, names and consent', () => {
    const e = validateContact({ first_name: ' ', last_name: 'x'.repeat(61), email: 'ana@', phone: '555-555-5555', consent: 'off' }).errors;
    expect(Object.keys(e).sort()).toEqual(['consent', 'email', 'first_name', 'last_name', 'phone']);
  });
  it('requires consent to be checked', () => {
    for (const consent of [undefined, '', 'off', 'false', false]) expect(validateContact({ ...good, consent }).errors.consent, String(consent)).toBeTruthy();
    expect(validateContact({ ...good, consent: true }).errors.consent).toBeUndefined();
  });
});

describe('validateLead', () => {
  it('normalizes a valid lead and derives state from the ZIP', () => {
    const v = validateLead(good);
    expect(v.kind).toBe('ok');
    if (v.kind !== 'ok') return;
    expect(v.lead).toMatchObject({
      first_name: 'Ana',
      last_name: 'Diaz',
      email: 'ana@example.com',
      phone: '+13052010123',
      street_address: '123 Palm Ave',
      zip: '33101',
      state: 'FL',
      homeowner: true,
      timeline: 'asap',
      shading: 'some',
      roof_age: '10_20',
      battery_interest: 'unsure',
      pay_method: 'loan',
      bill_bucket: '150_200',
      utility_id: 'fpl',
      source: 'results',
      page_path: '/calculator/florida',
      avg_monthly_bill: null,
      battery: null,
      estimate_snapshot: null,
    });
  });
  it('reports every missing field across all three steps', () => {
    const v = validateLead({});
    expect(v.kind).toBe('invalid');
    if (v.kind !== 'invalid') return;
    expect(Object.keys(v.fieldErrors).sort()).toEqual(
      ['battery_interest', 'bill_bucket', 'consent', 'email', 'first_name', 'homeowner', 'last_name', 'pay_method', 'phone', 'roof_age', 'shading', 'street_address', 'timeline', 'utility_id', 'zip'].sort(),
    );
  });
  it('renters are disqualified before anything else is checked', () => {
    expect(validateLead({ homeowner: 'no' })).toEqual({ kind: 'disqualified', reason: 'renter' });
    expect(validateLead({ ...good, homeowner: false })).toEqual({ kind: 'disqualified', reason: 'renter' });
  });
  it('honeypot wins', () => {
    expect(validateLead({ website: 'http://spam' }).kind).toBe('honeypot');
    expect(validateLead({ ...good, website: '' }).kind).toBe('ok');
  });
  it('keeps clean calculator context and drops malformed context', () => {
    const snap = { payback: { likely: '14 years', low: '11.5 years', high: '16.5 years' } };
    const v = validateLead({ ...good, bill: '200', battery: '0', estimate_snapshot: JSON.stringify(snap) });
    expect(v.kind === 'ok' && v.lead).toMatchObject({ utility_id: 'fpl', avg_monthly_bill: 200, battery: 0, estimate_snapshot: snap });
    const w = validateLead({ ...good, bill: '-5', battery: '7', estimate_snapshot: '{bad', source: 'evil', page_path: 'https://x.com/' });
    expect(w.kind === 'ok' && w.lead).toMatchObject({ avg_monthly_bill: null, battery: null, estimate_snapshot: null, source: 'quotes_page', page_path: null });
  });
  it('accepts the documented sources', () => {
    for (const src of ['results', 'quotes_page', 'home', 'city:florida/miami', 'city:california/san-diego']) {
      const v = validateLead({ ...good, source: src });
      expect(v.kind === 'ok' && v.lead.source).toBe(src);
    }
  });
});

describe('stepOfField', () => {
  it('maps fields to their step', () => {
    expect(stepOfField('zip')).toBe(1);
    expect(stepOfField('timeline')).toBe(2);
    expect(stepOfField('phone')).toBe(3);
    expect(stepOfField('form')).toBeNull();
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
