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
    if (init?.method !== 'POST' && (u.includes('/rest/v1/leads') || u.includes('/rest/v1/data_requests'))) return new Response('[]', { status: 200 });
    if (u.includes('/rest/v1/leads')) {
      if (insertStatus >= 400) return new Response('{"code":"X"}', { status: insertStatus });
      return new Response(JSON.stringify([{ id: leadId }]), { status: 201 });
    }
    throw new Error(`unexpected ${u} ${init?.method}`);
  });
}
const insertedRow = (f: ReturnType<typeof fakeDb>) => {
  const call = f.mock.calls.find(([u, i]) => String(u).includes('/rest/v1/leads') && i?.method === 'POST')!;
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
    const insert = f.mock.calls.find(([u, i]) => String(u).includes('/rest/v1/leads') && i?.method === 'POST')!;
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
    expect(f.mock.calls.some(([u, i]) => String(u).includes('/rest/v1/leads') && i?.method === 'POST')).toBe(false);
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
      if (i?.method !== 'POST') return new Response('[]', { status: 200 });
      n++;
      return JSON.parse(i!.body as string).utility_id ? new Response('{"code":"23503"}', { status: 409 }) : new Response('[{"id":"x"}]', { status: 201 });
    });
    const res = await handleLead(jsonReq(lead), ENV, asFetch(f));
    expect(res.status).toBe(200);
    expect(n).toBe(2);
  });
  it('other 409s are not retried', async () => {
    let n = 0;
    const f = vi.fn(async (u: unknown, i?: RequestInit) => {
      if (String(u).includes('/rpc/')) return new Response(JSON.stringify(['Acme Solar LLC', 'Bright Roofs Inc']), { status: 200 });
      if (i?.method !== 'POST') return new Response('[]', { status: 200 });
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

describe('handleLead: attribution, dedupe, Do Not Sell, routing, rate limit', () => {
  /** fakeDb plus configurable answers for the dedupe / suppression / buyers queries. */
  function db2(o: { priors?: unknown[]; dnsRequests?: unknown[]; rateOk?: boolean; buyers?: unknown[] } = {}) {
    const inner = fakeDb();
    const f = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const post = init?.method === 'POST';
      if (u.includes('/rpc/rate_limit_hit')) return new Response(JSON.stringify(o.rateOk ?? true), { status: 200 });
      if (u.includes('api.resend.com')) return new Response('{}', { status: 200 });
      if (!post && u.includes('/rest/v1/leads')) return new Response(JSON.stringify(new URL(u).searchParams.get('id') ? [{ ...routedLead }] : (o.priors ?? [])), { status: 200 });
      if (!post && u.includes('/rest/v1/data_requests')) return new Response(JSON.stringify(o.dnsRequests ?? []), { status: 200 });
      if (!post && u.includes('/rest/v1/buyers')) return new Response(JSON.stringify(o.buyers ?? []), { status: 200 });
      if (!post && u.includes('/rest/v1/lead_deliveries')) return new Response('[]', { status: 200 });
      if (init?.method === 'PATCH') return new Response('[{"id":"x"}]', { status: 200 });
      if (post && u.includes('/rest/v1/lead_deliveries')) return new Response(JSON.stringify([{ id: 'd1', lead_id: 'l', buyer_id: 'b1', method: 'email', status: 'queued', attempts: 0 }]), { status: 201 });
      return inner(url, init);
    });
    return f;
  }
  const routedLead = { id: '11111111-1111-4111-8111-111111111111', status: 'new', state: 'FL', zip: '33101', timeline: 'asap', source: 'quotes_page', bill_bucket: '150_200', phone_verified: false, homeowner: true, consented_installers: ['Acme Solar LLC', 'Bright Roofs Inc'] };
  const IP = { 'x-forwarded-for': '203.0.113.9' };
  const owner = { ...ENV, RESEND_API_KEY: 'r', EMAIL_FROM: 'a@rayvalue.com', OWNER_EMAIL: 'owner@example.com' };
  const posted = (f: ReturnType<typeof db2>, table: string) => f.mock.calls.filter(([u, i]) => String(u).includes(`/rest/v1/${table}`) && i?.method === 'POST').map(([, i]) => JSON.parse(i!.body as string));

  it('stores attribution columns (sanitized) sent by the browser', async () => {
    const f = db2();
    await handleLead(jsonReq({ ...lead, attribution: { utm_source: 'google', utm_medium: 'cpc', gclid: 'G<1>', landing_page: 'https://rayvalue.com/calculator/florida', referrer: 'https://www.google.com/search', evil: 'x' } }), ENV, asFetch(f));
    expect(posted(f, 'leads')[0]).toMatchObject({ utm_source: 'google', utm_medium: 'cpc', gclid: 'G1', landing_page: 'https://rayvalue.com/calculator/florida', referrer: 'https://www.google.com/search', utm_term: null, fbclid: null });
    expect(posted(f, 'leads')[0]).not.toHaveProperty('evil');
  });

  it('same phone or email within 30 days -> status duplicate, linked to the original, not routed, owner told', async () => {
    const f = db2({ priors: [{ id: '99999999-9999-4999-8999-999999999999', created_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), status: 'sent', phone: '+13052010123', email: 'x@y.co' }], buyers: [{ should: 'not be read' }] });
    const res = await handleLead(jsonReq(lead), owner, asFetch(f));
    const row = posted(f, 'leads')[0];
    expect(row).toMatchObject({ status: 'duplicate', duplicate_of: '99999999-9999-4999-8999-999999999999' });
    expect(f.mock.calls.some(([u]) => String(u).includes('/rest/v1/buyers'))).toBe(false);
    expect(posted(f, 'lead_deliveries')).toHaveLength(0);
    // the person sees the same answer as for a normal lead
    expect(await res.json()).toMatchObject({ ok: true, status: 'new', serviced: true });
    const mail = f.mock.calls.filter(([u]) => String(u).includes('api.resend.com')).map(([, i]) => JSON.parse(i!.body as string));
    expect(mail[0].subject).toContain('duplicate');
    expect(mail[0].to).toEqual(['owner@example.com']);
  });

  it('Do Not Sell email -> disqualified, never routed', async () => {
    const f = db2({ dnsRequests: [{ email: 'ana@example.com', request: 'do_not_sell', status: 'new' }], buyers: [{}] });
    await handleLead(jsonReq(lead), ENV, asFetch(f));
    expect(posted(f, 'leads')[0]).toMatchObject({ status: 'disqualified', status_reason: 'do_not_sell' });
    expect(f.mock.calls.some(([u]) => String(u).includes('/rest/v1/buyers'))).toBe(false);
  });

  it('if the dedupe check fails the lead is saved but not routed', async () => {
    const inner = db2();
    const f = vi.fn(async (u: unknown, i?: RequestInit) => (i?.method !== 'POST' && String(u).includes('/rest/v1/leads') && String(u).includes('or=') ? new Response('{}', { status: 500 }) : inner(u, i)));
    const res = await handleLead(jsonReq(lead), ENV, asFetch(f));
    expect(res.status).toBe(200);
    expect(posted(inner, 'leads')[0]).toMatchObject({ status: 'new', status_reason: 'dedupe_check_failed' });
    expect(inner.mock.calls.some(([u]) => String(u).includes('/rest/v1/buyers'))).toBe(false);
  });

  it('a unique serviced lead is routed after saving and the owner gets a summary', async () => {
    const buyer = { id: 'b1', created_at: '2026-01-01T00:00:00Z', name: 'Acme', legal_name: 'Acme Solar LLC', states: ['FL'], zips: [], active: true, accepted_timelines: ['asap'], min_bill_bucket: null, homeowner_only: true, exclusive: false, daily_cap: null, price: null, delivery_method: 'email', delivery_target: 'sales@acme.example', delivery_target_env: null, webhook_secret_env: null, fallback_email_env: null, business_hours: null };
    const f = db2({ buyers: [buyer] });
    const res = await handleLead(jsonReq(lead), owner, asFetch(f));
    expect((await res.json()).status).toBe('new');
    expect(posted(f, 'lead_deliveries')).toHaveLength(1);
    const mail = f.mock.calls.filter(([u]) => String(u).includes('api.resend.com')).map(([, i]) => JSON.parse(i!.body as string));
    expect(mail.map((m) => m.to[0]).sort()).toEqual(['owner@example.com', 'sales@acme.example']);
    const summary = mail.find((m) => m.to[0] === 'owner@example.com');
    expect(summary.text).not.toMatch(/ana@example|201-0123|Palm/);
  });

  it('unserviced and nurture leads are not routed', async () => {
    const f = db2();
    await handleLead(jsonReq({ ...lead, timeline: 'researching' }), ENV, asFetch(f));
    expect(f.mock.calls.some(([u]) => String(u).includes('/rest/v1/buyers'))).toBe(false);
  });

  it('rate limit: over the limit -> 429 and nothing looked up or stored', async () => {
    const f = db2({ rateOk: false });
    const res = await handleLead(jsonReq(lead, IP), ENV, asFetch(f));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('600');
    expect(posted(f, 'leads')).toHaveLength(0);
    expect(f.mock.calls.some(([u]) => String(u).includes('installers_for_zip'))).toBe(false);
  });
  it('rate limit: under the limit passes; a failing limiter fails open', async () => {
    expect((await handleLead(jsonReq(lead, IP), ENV, asFetch(db2()))).status).toBe(200);
    const inner = db2();
    const broken = vi.fn(async (u: unknown, i?: RequestInit) => (String(u).includes('rate_limit_hit') ? new Response('x', { status: 500 }) : inner(u, i)));
    expect((await handleLead(jsonReq(lead, IP), ENV, asFetch(broken))).status).toBe(200);
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
