import { describe, expect, it, vi } from 'vitest';
import { handleDataRequest, handleLead, insertRequest, readBody } from './leads';

const ENV = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
const ORIGIN = 'https://rayvalue.com';
const req = (path: string, body: BodyInit, type: string, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, { method: 'POST', body, headers: { 'content-type': type, origin: ORIGIN, 'user-agent': 'UA/1', ...headers } });
const jsonReq = (o: unknown, h: Record<string, string> = {}) => req('/api/leads', JSON.stringify(o), 'application/json', h);
const formReq = (path: string, o: Record<string, string>, h: Record<string, string> = {}) => req(path, new URLSearchParams(o).toString(), 'application/x-www-form-urlencoded', h);
const mockFetch = (status: number) => vi.fn(async (_u: unknown, _i?: RequestInit) => new Response(null, { status }));
const asFetch = (f: unknown) => f as typeof fetch;

const lead = { first_name: 'Ana', email: 'ana@example.com', phone: '305-555-0123', zip: '33101', homeowner: 'yes', timeline: 'asap', consent: 'on', source: 'quotes_page' };

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
    const { url, init } = insertRequest({ url: 'https://proj.supabase.co/', key: 'K' }, 'leads', { a: 1 });
    expect(url).toBe('https://proj.supabase.co/rest/v1/leads');
    expect(init.headers).toEqual({ apikey: 'K', 'Content-Type': 'application/json', Prefer: 'return=minimal' });
  });
});

describe('handleLead', () => {
  it('inserts a normalized lead; consent is never taken from the client (the DB sets it); JSON 200', async () => {
    const f = mockFetch(201);
    const res = await handleLead(jsonReq({ ...lead, consent_text: 'I agreed to nothing', consent_version: 'fake' }), ENV, asFetch(f));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://proj.supabase.co/rest/v1/leads');
    const row = JSON.parse(init!.body as string);
    expect(row).toMatchObject({ phone: '+13055550123', state: 'FL', user_agent: 'UA/1' });
    for (const k of ['consent', 'consent_text', 'consent_version', 'consent_at']) expect(row).not.toHaveProperty(k);
    expect(row).not.toHaveProperty('status');
  });
  it('field errors -> 400 JSON, no insert', async () => {
    const f = mockFetch(201);
    const res = await handleLead(jsonReq({ ...lead, phone: '123', consent: '' }), ENV, asFetch(f));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(Object.keys(body.fieldErrors).sort()).toEqual(['consent', 'phone']);
    expect(f).not.toHaveBeenCalled();
  });
  it('honeypot -> looks like success, no insert', async () => {
    const f = mockFetch(201);
    const res = await handleLead(jsonReq({ ...lead, website: 'spam' }), ENV, asFetch(f));
    expect([res.status, await res.json()]).toEqual([200, { ok: true }]);
    expect(f).not.toHaveBeenCalled();
  });
  it('cross-origin -> 403', async () => {
    const res = await handleLead(jsonReq(lead, { origin: 'https://evil.example' }), ENV, asFetch(mockFetch(201)));
    expect(res.status).toBe(403);
  });
  it('database failure, timeout or missing env -> 502 generic', async () => {
    expect((await handleLead(jsonReq(lead), ENV, asFetch(mockFetch(500)))).status).toBe(502);
    const boom = vi.fn(async () => { throw new DOMException('t', 'TimeoutError'); });
    expect((await handleLead(jsonReq(lead), ENV, asFetch(boom))).status).toBe(502);
    expect((await handleLead(jsonReq(lead), {}, asFetch(mockFetch(201)))).status).toBe(502);
  });
  it('plain form post -> 303 to /quotes/thanks, errors -> ?error=1', async () => {
    const h = { accept: 'text/html' };
    const ok = await handleLead(formReq('/api/leads', lead, h), ENV, asFetch(mockFetch(201)));
    expect([ok.status, ok.headers.get('location')]).toEqual([303, '/quotes/thanks']);
    const bad = await handleLead(formReq('/api/leads', { ...lead, email: 'x' }, h), ENV, asFetch(mockFetch(201)));
    expect([bad.status, bad.headers.get('location')]).toEqual([303, '/quotes/thanks?error=1']);
  });
  it('never logs submitted values', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await handleLead(jsonReq(lead), ENV, asFetch(mockFetch(500)));
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).not.toMatch(/ana|555|33101/i);
    spy.mockRestore();
  });
});

describe('handleDataRequest', () => {
  it('inserts and redirects form posts to the privacy thanks page', async () => {
    const f = mockFetch(201);
    const res = await handleDataRequest(formReq('/api/data-requests', { email: 'A@b.co', request: 'delete', details: 'pls' }, { accept: 'text/html' }), ENV, asFetch(f));
    expect([res.status, res.headers.get('location')]).toEqual([303, '/privacy/request/thanks']);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://proj.supabase.co/rest/v1/data_requests');
    expect(JSON.parse(init!.body as string)).toEqual({ email: 'a@b.co', request: 'delete', details: 'pls' });
  });
  it('invalid -> 400 JSON / honeypot -> silent success', async () => {
    const bad = await handleDataRequest(req('/api/data-requests', JSON.stringify({ email: 'x', request: 'delete' }), 'application/json'), ENV, asFetch(mockFetch(201)));
    expect(bad.status).toBe(400);
    const f = mockFetch(201);
    const hp = await handleDataRequest(req('/api/data-requests', JSON.stringify({ website: 'x' }), 'application/json'), ENV, asFetch(f));
    expect(hp.status).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });
});
