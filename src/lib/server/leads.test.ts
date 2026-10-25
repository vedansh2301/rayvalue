import { describe, expect, it, vi } from 'vitest';
import { CONSENT_VERSION_AREA, CONSENT_VERSION_NAMED, consentFor } from '../leads/consent';
import { checkLeadToken } from './verify';
import { cleanCertUrl, handleDataRequest, handleLead, insertRequest, readBody } from './leads';

const ENV = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test' };
const VERIFY_ENV = { ...ENV, TWILIO_ACCOUNT_SID: 'ACx', TWILIO_AUTH_TOKEN: 'tok', TWILIO_VERIFY_SERVICE_SID: 'VAx', LEAD_SIGNING_SECRET: 'signing-secret' };
const ORIGIN = 'https://rayvalue.com';
const req = (path: string, body: BodyInit, type: string, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, { method: 'POST', body, headers: { 'content-type': type, origin: ORIGIN, 'user-agent': 'UA/1', ...headers } });
const jsonReq = (o: unknown, h: Record<string, string> = {}) => req('/api/leads', JSON.stringify(o), 'application/json', h);
const formReq = (path: string, o: Record<string, string>, h: Record<string, string> = {}) => req(path, new URLSearchParams(o).toString(), 'application/x-www-form-urlencoded', h);
const asFetch = (f: unknown) => f as typeof fetch;

const lead = {
  zip: '33101',
  street_address: '123 Palm Ave',
  homeowner: 'yes',
  bill_bucket: '150_200',
  utility_id: 'fpl',
  shading: 'some',
  roof_age: '10_20',
  battery_interest: 'no',
  pay_method: 'cash',
  timeline: 'asap',
  first_name: 'Ana',
  last_name: 'Diaz',
  email: 'ana@example.com',
  phone: '305-201-0123',
  consent: 'on',
  source: 'quotes_page',
  consent_installers: ['Acme Solar LLC', 'Bright Roofs Inc'],
  page_url: 'https://rayvalue.com/quotes?zip=33101',
};

/** A fetch double: rpc installers_for_zip -> `installers`; POST leads -> `insertStatus`. */
function fakeDb(installers: string[] = ['Acme Solar LLC', 'Bright Roofs Inc'], insertStatus = 201, leadId = '11111111-1111-4111-8111-111111111111') {
  return vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/rpc/installers_for_zip')) return new Response(JSON.stringify(installers), { status: 200 });
    if (u.includes('/rest/v1/leads')) {
      if (insertStatus >= 400) return new Response('{"code":"X"}', { status: insertStatus });
      return new Response(JSON.stringify([{ id: leadId }]), { status: 201 });
    }
    throw new Error(`unexpected ${u} ${init?.method}`);
  });
}
const insertedRow = (f: ReturnType<typeof fakeDb>) => {
  const call = f.mock.calls.find(([u]) => String(u).includes('/rest/v1/leads'))!;
  return JSON.parse(call[1]!.body as string);
};

describe('readBody', () => {
  it('reads JSON and forms, rejects oversize and other types', async () => {
    expect(await readBody(jsonReq({ a: 1 }))).toEqual({ a: 1 });
    expect(await readBody(formReq('/api/leads', { a: 'b' }))).toEqual({ a: 'b' });
    expect(await readBody(jsonReq({ a: 'x'.repeat(9000) }))).toBeNull();
    expect(await readBody(req('/api/leads', 'x', 'text/plain'))).toBeNull();
    expect(await readBody(req('/api/leads', '[1]', 'application/json'))).toBeNull();
  });
});

describe('insertRequest', () => {
  it('posts to PostgREST with return=minimal', () => {
    const { url, init } = insertRequest({ url: 'https://proj.supabase.co/', key: 'K' }, 'data_requests', { a: 1 });
    expect(url).toBe('https://proj.supabase.co/rest/v1/data_requests');
    expect(init.headers).toEqual({ apikey: 'K', 'Content-Type': 'application/json', Prefer: 'return=minimal' });
  });
});

describe('cleanCertUrl', () => {
  it('accepts only TrustedForm certificate URLs', () => {
    const ok = 'https://cert.trustedform.com/0123456789abcdef0123456789abcdef01234567';
    expect(cleanCertUrl(ok)).toBe(ok);
    expect(cleanCertUrl(`${ok}?ping=1`)).toBe(ok);
    for (const bad of ['http://cert.trustedform.com/abc', 'https://evil.com/0123456789abcdef0123456789abcdef01234567', '', null, 5]) expect(cleanCertUrl(bad)).toBeNull();
  });
});

describe('handleLead', () => {
  it('stores a serviced lead with server-composed consent, status new, installers and evidence', async () => {
    const f = fakeDb();
    const res = await handleLead(
      jsonReq({ ...lead, consent_text: 'I agreed to nothing', consent_version: 'fake', status: 'sold', phone_verified: true, trustedform_cert_url: 'https://cert.trustedform.com/0123456789abcdef0123456789abcdef01234567' }, { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }),
      ENV,
      asFetch(f),
      [ORIGIN],
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true, status: 'new', serviced: true, installers: ['Acme Solar LLC', 'Bright Roofs Inc'], lead_id: '11111111-1111-4111-8111-111111111111', verify: null });
    const row = insertedRow(f);
    const consent = consentFor(['Acme Solar LLC', 'Bright Roofs Inc']);
    expect(row).toMatchObject({
      first_name: 'Ana',
      last_name: 'Diaz',
      phone: '+13052010123',
      state: 'FL',
      street_address: '123 Palm Ave',
      status: 'new',
      phone_verified: false,
      consent_text: consent.text,
      consent_version: CONSENT_VERSION_NAMED,
      consented_installers: ['Acme Solar LLC', 'Bright Roofs Inc'],
      consent_ip: '203.0.113.9',
      consent_page_url: 'https://rayvalue.com/quotes',
      trustedform_cert_url: 'https://cert.trustedform.com/0123456789abcdef0123456789abcdef01234567',
      user_agent: 'UA/1',
    });
    expect(row.consent_text).toContain('Acme Solar LLC and Bright Roofs Inc');
    for (const k of ['consent', 'website', 'consent_installers', 'page_url']) expect(row).not.toHaveProperty(k);
    const insert = f.mock.calls.find(([u]) => String(u).includes('/rest/v1/leads'))!;
    expect((insert[1]!.headers as Record<string, string>).apikey).toBe('sb_secret_test');
  });

  it('unserviced ZIP -> status unserviced, generic consent wording, still stored', async () => {
    const f = fakeDb([]);
    const res = await handleLead(jsonReq({ ...lead, consent_installers: [] }), ENV, asFetch(f));
    expect(await res.json()).toMatchObject({ ok: true, status: 'unserviced', serviced: false, installers: [] });
    expect(insertedRow(f)).toMatchObject({ status: 'unserviced', consent_version: CONSENT_VERSION_AREA, consented_installers: [] });
    expect(insertedRow(f).consent_text).toContain('solar installers serving my area');
  });

  it('"Just researching" at a serviced ZIP -> nurture', async () => {
    const f = fakeDb();
    await handleLead(jsonReq({ ...lead, timeline: 'researching' }), ENV, asFetch(f));
    expect(insertedRow(f).status).toBe('nurture');
  });

  it('renter -> friendly disqualified answer, nothing looked up or stored', async () => {
    const f = fakeDb();
    const res = await handleLead(jsonReq({ ...lead, homeowner: 'no' }), ENV, asFetch(f));
    expect([res.status, await res.json()]).toEqual([200, { ok: true, disqualified: 'renter' }]);
    expect(f).not.toHaveBeenCalled();
  });

  it('installer list changed since the form showed it -> 409 with the new list, nothing stored', async () => {
    const f = fakeDb(['Acme Solar LLC']);
    const res = await handleLead(jsonReq(lead), ENV, asFetch(f));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, consent_changed: true, installers: ['Acme Solar LLC'] });
    expect(f.mock.calls.some(([u]) => String(u).includes('/rest/v1/leads'))).toBe(false);
  });

  it('a client that sends no installer list cannot get named consent stored', async () => {
    const f = fakeDb();
    const { consent_installers: _drop, ...noList } = lead;
    expect((await handleLead(jsonReq(noList), ENV, asFetch(f))).status).toBe(409);
  });

  it('adds a signed verification token only when Twilio Verify is fully configured', async () => {
    const f = fakeDb();
    const now = Date.parse('2026-10-26T12:00:00Z');
    const res = await handleLead(jsonReq(lead), VERIFY_ENV, asFetch(f), [], now);
    const body = await res.json();
    expect(body.verify.token).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(checkLeadToken('signing-secret', body.lead_id, body.verify.token, now)).toBe(true);
    expect(checkLeadToken('signing-secret', '22222222-2222-4222-8222-222222222222', body.verify.token, now)).toBe(false);
    expect(checkLeadToken('other-secret', body.lead_id, body.verify.token, now)).toBe(false);
    expect(checkLeadToken('signing-secret', body.lead_id, body.verify.token, now + 31 * 60_000)).toBe(false);
    const partial = await handleLead(jsonReq(lead), { ...VERIFY_ENV, TWILIO_AUTH_TOKEN: undefined }, asFetch(fakeDb()));
    expect((await partial.json()).verify).toBeNull();
  });

  it('unknown utility_id (FK violation) -> retried without it, lead kept', async () => {
    let n = 0;
    const f = vi.fn(async (u: unknown, i?: RequestInit) => {
      if (String(u).includes('/rpc/')) return new Response(JSON.stringify(['Acme Solar LLC', 'Bright Roofs Inc']), { status: 200 });
      n++;
      return JSON.parse(i!.body as string).utility_id ? new Response('{"code":"23503"}', { status: 409 }) : new Response('[{"id":"x"}]', { status: 201 });
    });
    const res = await handleLead(jsonReq(lead), ENV, asFetch(f));
    expect(res.status).toBe(200);
    expect(n).toBe(2);
  });
  it('other 409s are not retried', async () => {
    let n = 0;
    const f = vi.fn(async (u: unknown) => {
      if (String(u).includes('/rpc/')) return new Response(JSON.stringify(['Acme Solar LLC', 'Bright Roofs Inc']), { status: 200 });
      n++;
      return new Response('{"code":"23505"}', { status: 409 });
    });
    expect((await handleLead(jsonReq(lead), ENV, asFetch(f))).status).toBe(502);
    expect(n).toBe(1);
  });

  it('field errors -> 400 JSON, no lookup, no insert', async () => {
    const f = fakeDb();
    const res = await handleLead(jsonReq({ ...lead, phone: '555-555-5555', consent: '' }), ENV, asFetch(f));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Object.keys(body.fieldErrors).sort()).toEqual(['consent', 'phone']);
    expect(f).not.toHaveBeenCalled();
  });
  it('honeypot -> looks like success, no insert', async () => {
    const f = fakeDb();
    const res = await handleLead(jsonReq({ ...lead, website: 'spam' }), ENV, asFetch(f));
    expect([res.status, await res.json()]).toEqual([200, { ok: true }]);
    expect(f).not.toHaveBeenCalled();
  });
  it('cross-origin -> 403', async () => {
    const res = await handleLead(jsonReq(lead, { origin: 'https://evil.example' }), ENV, asFetch(fakeDb()));
    expect(res.status).toBe(403);
  });
  it('database failure, timeout, missing keys -> 502 generic', async () => {
    expect((await handleLead(jsonReq(lead), ENV, asFetch(fakeDb(undefined, 500)))).status).toBe(502);
    const boom = vi.fn(async () => {
      throw new DOMException('t', 'TimeoutError');
    });
    expect((await handleLead(jsonReq(lead), ENV, asFetch(boom))).status).toBe(502);
    expect((await handleLead(jsonReq(lead), {}, asFetch(fakeDb()))).status).toBe(502);
    // no secret key: the lookup works but the insert cannot be made
    expect((await handleLead(jsonReq(lead), { ...ENV, SUPABASE_SECRET_KEY: undefined }, asFetch(fakeDb()))).status).toBe(502);
  });
  it('plain form post -> 303 to /quotes/thank-you, errors -> ?error=1', async () => {
    const h = { accept: 'text/html' };
    const flat = { ...lead, consent_installers: '' } as Record<string, string>;
    const bad = await handleLead(formReq('/api/leads', { ...flat, email: 'x' }, h), ENV, asFetch(fakeDb()));
    expect([bad.status, bad.headers.get('location')]).toEqual([303, '/quotes/thank-you?error=1']);
  });
  it('never logs submitted values', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await handleLead(jsonReq(lead), ENV, asFetch(fakeDb(undefined, 500)));
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).not.toMatch(/ana|201-0123|33101|Palm/i);
    spy.mockRestore();
  });
});

describe('handleDataRequest', () => {
  const mock = (status: number) => vi.fn(async (_u: unknown, _i?: RequestInit) => new Response(null, { status }));
  it('inserts and redirects form posts to the privacy thanks page', async () => {
    const f = mock(201);
    const res = await handleDataRequest(formReq('/api/data-requests', { email: 'A@b.co', request: 'delete', details: 'pls' }, { accept: 'text/html' }), ENV, asFetch(f));
    expect([res.status, res.headers.get('location')]).toEqual([303, '/privacy/request/thanks']);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://proj.supabase.co/rest/v1/data_requests');
    expect(JSON.parse(init!.body as string)).toEqual({ email: 'a@b.co', request: 'delete', details: 'pls' });
  });
  it('invalid -> 400 JSON / honeypot -> silent success', async () => {
    const bad = await handleDataRequest(req('/api/data-requests', JSON.stringify({ email: 'x', request: 'delete' }), 'application/json'), ENV, asFetch(mock(201)));
    expect(bad.status).toBe(400);
    const f = mock(201);
    const hp = await handleDataRequest(req('/api/data-requests', JSON.stringify({ website: 'x' }), 'application/json'), ENV, asFetch(f));
    expect(hp.status).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });
});
