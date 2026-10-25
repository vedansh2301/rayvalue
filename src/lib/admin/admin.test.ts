import { describe, expect, it } from 'vitest';
import { adminConfigured, checkBasicAuth, strictSameOrigin } from './auth';
import { csvCell, toCsv } from './csv';
import { leadsCsv, statusFilter, validateReturn, type AdminLead } from './leads';

const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

describe('basic auth', () => {
  it('accepts the password with any username; rejects wrong, missing and malformed', () => {
    expect(checkBasicAuth(basic('x', 'correct horse battery'), 'correct horse battery')).toBe(true);
    expect(checkBasicAuth(basic('', 'correct horse battery'), 'correct horse battery')).toBe(true);
    expect(checkBasicAuth(basic('x', 'wrong'), 'correct horse battery')).toBe(false);
    expect(checkBasicAuth(null, 'p')).toBe(false);
    expect(checkBasicAuth('Bearer abc', 'p')).toBe(false);
    expect(checkBasicAuth('Basic !!!', 'p')).toBe(false);
    expect(checkBasicAuth(`Basic ${Buffer.from('nocolon').toString('base64')}`, 'nocolon')).toBe(false);
  });
  it('a password containing colons works', () => expect(checkBasicAuth(basic('u', 'a:b:c-long-pass'), 'a:b:c-long-pass')).toBe(true));
  it('admin is off unless the password is long enough', () => {
    expect(adminConfigured(undefined)).toBe(false);
    expect(adminConfigured('short')).toBe(false);
    expect(adminConfigured('a-long-enough-password')).toBe(true);
  });
});

describe('strictSameOrigin', () => {
  const r = (h: Record<string, string>) => new Request('https://rayvalue.com/admin/leads', { method: 'POST', headers: h });
  it('requires an Origin or Sec-Fetch-Site that is ours', () => {
    expect(strictSameOrigin(r({ origin: 'https://rayvalue.com' }))).toBe(true);
    expect(strictSameOrigin(r({ origin: 'https://evil.example' }))).toBe(false);
    expect(strictSameOrigin(r({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(strictSameOrigin(r({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(strictSameOrigin(r({}))).toBe(false);
  });
});

describe('csv', () => {
  it('quotes commas, quotes and newlines; neutralizes formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1555')).toBe("'+1555");
    expect(csvCell(null)).toBe('');
    expect(csvCell(true)).toBe('true');
  });
  it('writes a header and CRLF rows', () => {
    expect(toCsv([{ a: 1 }, { a: 'x,y' }], [{ header: 'a', value: (r) => r.a }])).toBe('a\r\n1\r\n"x,y"\r\n');
  });
});

describe('leads admin helpers', () => {
  it('status filter accepts only the seven statuses', () => {
    expect(statusFilter('duplicate')).toBe('duplicate');
    expect(statusFilter('sold')).toBeNull();
    expect(statusFilter(null)).toBeNull();
  });
  it('return form validation', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(validateReturn(new URLSearchParams({ id, reason: ' bad number ' }))).toEqual({ ok: true, id, reason: 'bad number' });
    expect(validateReturn(new URLSearchParams({ id, reason: 'x' })).ok).toBe(false);
    expect(validateReturn(new URLSearchParams({ id: 'nope', reason: 'valid reason' })).ok).toBe(false);
    expect(validateReturn(new URLSearchParams({ id, reason: 'x'.repeat(501) })).ok).toBe(false);
  });
  it('csv export includes source, buyer and verification columns', () => {
    const lead = { id: 'i', created_at: 'c', status: 'sent', status_reason: null, first_name: '=cmd', last_name: 'D', email: 'e@x.co', phone: '+13052010123', phone_verified: true, zip: '33101', state: 'FL', source: 'results', timeline: 'asap', bill_bucket: '200_300', utm_source: 'google', utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null, gclid: null, fbclid: null, landing_page: null, referrer: null, consent_version: 'v', consent_at: 'a', trustedform_cert_url: null, duplicate_of: null, returned_at: null, return_reason: null, lead_deliveries: [{ status: 'delivered', error: null, response_status: 200, used_fallback: false, buyers: { name: 'Acme' } }] } as AdminLead;
    const csv = leadsCsv([lead]);
    const [head, row] = csv.split('\r\n');
    expect(head).toContain('utm_source');
    expect(row).toContain('Acme (delivered)');
    expect(row).toContain("'=cmd");
    expect(row).toContain('true');
  });
});

describe('admin is kept out of search', () => {
  it('robots.txt disallows /admin/ and /api/', async () => {
    const { readFileSync } = await import('node:fs');
    const robots = readFileSync('public/robots.txt', 'utf8');
    expect(robots).toContain('Disallow: /admin/');
    expect(robots).toContain('Disallow: /api/');
  });
  it('the sitemap filter in astro.config excludes /admin', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('astro.config.mjs', 'utf8')).toContain("!path.startsWith('/admin')");
  });
});
