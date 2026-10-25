import { describe, expect, it } from 'vitest';
import { buildLeadEmail, buildPayload, classifyResponse, excerpt, MAX_TOTAL_ATTEMPTS, nextAttemptAt, signBody, validEmailTarget, validWebhookUrl, verifySignature, type LeadRecord } from './delivery';

const lead: LeadRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  created_at: '2026-10-26T12:00:00Z',
  first_name: 'Ana', last_name: 'Diaz', email: 'ana@example.com', phone: '+13052010123', phone_verified: true,
  street_address: '123 Palm Ave', zip: '33101', state: 'FL', utility_id: 'fpl', bill_bucket: '200_300', avg_monthly_bill: '250', homeowner: true,
  roof_age: '10_20', shading: 'some', battery: 1, battery_interest: 'yes', pay_method: 'cash', timeline: 'asap', estimate_snapshot: { payback: { value: '8' } },
  source: 'results', utm_source: 'google', utm_medium: 'cpc', utm_campaign: null, utm_term: null, utm_content: null, gclid: 'G', fbclid: null,
  landing_page: 'https://rayvalue.com/', referrer: null,
  consent_text: 'By clicking ...', consent_version: '2026-10-25.1', consent_at: '2026-10-26T12:00:00Z', consent_ip: '203.0.113.9',
  consent_page_url: 'https://rayvalue.com/quotes', trustedform_cert_url: 'https://cert.trustedform.com/0123456789abcdef0123456789abcdef01234567', consented_installers: ['Acme Solar LLC'],
};

describe('signature', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  it('signs and verifies; tamper, wrong secret and replay fail', () => {
    const h = signBody('s3cret', '{"a":1}', now);
    expect(h).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifySignature('s3cret', '{"a":1}', h, now)).toBe(true);
    expect(verifySignature('s3cret', '{"a":2}', h, now)).toBe(false);
    expect(verifySignature('other', '{"a":1}', h, now)).toBe(false);
    expect(verifySignature('s3cret', '{"a":1}', h, now + 10 * 60_000)).toBe(false);
    expect(verifySignature('s3cret', '{"a":1}', 'garbage', now)).toBe(false);
  });
});

describe('payload', () => {
  it('carries consent evidence, certificate URL and consent version', () => {
    const p = buildPayload(lead, 'd1');
    expect(p.consent).toMatchObject({ version: '2026-10-25.1', trustedform_cert_url: lead.trustedform_cert_url, installers: ['Acme Solar LLC'], ip: '203.0.113.9' });
    expect(p.project.avg_monthly_bill).toBe(250);
    expect(p.source).toMatchObject({ utm_source: 'google', gclid: 'G' });
    expect(p.delivery_id).toBe('d1');
  });
});

describe('classifyResponse / retry schedule', () => {
  it('2xx ok, 5xx/429/408 retry, other 4xx permanent', () => {
    expect([200, 204].map(classifyResponse)).toEqual(['ok', 'ok']);
    expect([500, 502, 429, 408].map(classifyResponse)).toEqual(['retry', 'retry', 'retry', 'retry']);
    expect([400, 401, 404, 422, 301].map(classifyResponse)).toEqual(['permanent', 'permanent', 'permanent', 'permanent', 'permanent']);
  });
  it('backs off and stops at the cap', () => {
    const t = new Date('2026-10-26T12:00:00Z');
    expect(nextAttemptAt(3, t)?.toISOString()).toBe('2026-10-26T12:05:00.000Z');
    expect(nextAttemptAt(4, t)?.toISOString()).toBe('2026-10-26T12:30:00.000Z');
    expect(nextAttemptAt(MAX_TOTAL_ATTEMPTS, t)).toBeNull();
  });
});

describe('targets', () => {
  it('webhook URLs must be public https', () => {
    expect(validWebhookUrl('https://crm.example.com/hook?x=1')).toBe('https://crm.example.com/hook?x=1');
    for (const bad of ['http://crm.example.com', 'https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://user:pw@a.example.com', 'https://intranet/x', 'https://a.local/x', 'nope', '', null, undefined]) expect(validWebhookUrl(bad as string)).toBeNull();
  });
  it('email targets', () => {
    expect(validEmailTarget('a@b.co')).toBe('a@b.co');
    expect(validEmailTarget('a b@c.co')).toBeNull();
    expect(validEmailTarget('a@b.co, c@d.co')).toBeNull();
    expect(validEmailTarget(undefined)).toBeNull();
  });
  it('excerpt strips control characters and truncates', () => expect(excerpt(`a\nb${'x'.repeat(400)}`)).toHaveLength(300));
});

describe('buyer email', () => {
  it('includes lead facts, verification note and the consent evidence', () => {
    const e = buildLeadEmail(lead, 'Acme');
    expect(e.subject).toContain('FL');
    for (const s of ['Ana Diaz', '+13052010123 (verified by SMS code)', '$200–$300', 'Consent version: 2026-10-25.1', 'cert.trustedform.com', 'By clicking ...', 'Lead ID: 1111']) expect(e.text).toContain(s);
  });
  it('unverified phone and missing certificate are stated, not hidden', () => {
    const e = buildLeadEmail({ ...lead, phone_verified: false, trustedform_cert_url: null }, 'Acme');
    expect(e.text).toContain('(not verified)');
    expect(e.text).toContain('TrustedForm certificate: n/a');
  });
});
