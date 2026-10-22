import { describe, expect, it, vi } from 'vitest';
import { handleSubscribe, isSameOrigin, prefersHtml, supabaseInsertRequest, validateSignup } from './subscribe';

const ENV = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
const ORIGIN = 'https://rayvalue.com';
function post(body: BodyInit, type: string, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/subscribe`, { method: 'POST', body, headers: { 'content-type': type, origin: ORIGIN, ...headers } });
}
const form = (o: Record<string, string>, h: Record<string, string> = {}) => post(new URLSearchParams(o).toString(), 'application/x-www-form-urlencoded', h);
const jsonReq = (o: unknown, h: Record<string, string> = {}) => post(JSON.stringify(o), 'application/json', h);
const mockFetch = (status: number) => vi.fn(async (_u: unknown, _i?: RequestInit) => new Response(status === 201 ? null : '{"code":"23505"}', { status }));
const asFetch = (f: unknown) => f as typeof fetch;

describe('validateSignup', () => {
  it('trims, lowercases, accepts FL/CA', () => {
    expect(validateSignup({ email: '  Foo@Example.COM ', state: 'fl' })).toEqual({ kind: 'ok', email: 'foo@example.com', state: 'FL' });
  });
  it('rejects bad emails and states', () => {
    for (const email of ['', 'nope', 'a@b', 'a b@c.com', '@c.com', 'a@@c.com', 'x'.repeat(250) + '@a.com', 42]) {
      expect(validateSignup({ email, state: 'FL' }).kind, String(email)).toBe('invalid');
    }
    expect(validateSignup({ email: 'a@b.co', state: 'TX' }).kind).toBe('invalid');
    expect(validateSignup({ email: 'a@b.co' }).kind).toBe('invalid');
  });
  it('honeypot wins', () => {
    expect(validateSignup({ email: 'bad', state: 'x', website: 'http://spam' }).kind).toBe('honeypot');
    expect(validateSignup({ email: 'a@b.co', state: 'FL', website: '' }).kind).toBe('ok');
  });
});

describe('request construction', () => {
  it('matches the verified Supabase REST contract', () => {
    const { url, init } = supabaseInsertRequest({ url: 'https://proj.supabase.co/', key: 'K' }, 'a@b.co', 'CA');
    expect(url).toBe('https://proj.supabase.co/rest/v1/rate_alert_subscribers');
    expect(init.headers).toEqual({ apikey: 'K', 'Content-Type': 'application/json', Prefer: 'return=minimal' });
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.co', state: 'CA', source: 'calculator-ca' });
  });
});

describe('origin + accept helpers', () => {
  it('same-origin logic', () => {
    const mk = (h: Record<string, string>) => new Request(`${ORIGIN}/api/subscribe`, { method: 'POST', headers: h });
    expect(isSameOrigin(mk({ origin: ORIGIN }))).toBe(true);
    expect(isSameOrigin(mk({ origin: 'https://evil.example' }))).toBe(false);
    expect(isSameOrigin(mk({ origin: 'https://www.rayvalue.com' }), ['https://www.rayvalue.com'])).toBe(true);
    expect(isSameOrigin(mk({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(isSameOrigin(mk({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(isSameOrigin(mk({ referer: 'https://evil.example/x' }))).toBe(false);
    expect(isSameOrigin(mk({}))).toBe(true);
  });
  it('prefersHtml', () => {
    const a = (accept: string) => new Request(ORIGIN, { headers: { accept } });
    expect(prefersHtml(a('text/html,application/xhtml+xml,*/*;q=0.8'))).toBe(true);
    expect(prefersHtml(a('application/json'))).toBe(false);
    expect(prefersHtml(a('application/json, text/html'))).toBe(false);
    expect(prefersHtml(a('*/*'))).toBe(false);
  });
});

describe('handleSubscribe', () => {
  it('new signup (201) -> JSON 200, one correct insert', async () => {
    const f = mockFetch(201);
    const res = await handleSubscribe(jsonReq({ email: 'A@b.co', state: 'FL' }), ENV, asFetch(f));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://proj.supabase.co/rest/v1/rate_alert_subscribers');
    expect((init!.headers as Record<string, string>).apikey).toBe('sb_publishable_test');
    expect(JSON.parse(init!.body as string)).toEqual({ email: 'a@b.co', state: 'FL', source: 'calculator-fl' });
  });
  it('duplicate (409) is success, indistinguishable from new', async () => {
    const res = await handleSubscribe(jsonReq({ email: 'a@b.co', state: 'CA' }), ENV, asFetch(mockFetch(409)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
  it('form post with Accept html -> 303 to thanks; errors -> ?error=1', async () => {
    const h = { accept: 'text/html' };
    const ok = await handleSubscribe(form({ email: 'a@b.co', state: 'FL' }, h), ENV, asFetch(mockFetch(201)));
    expect([ok.status, ok.headers.get('location')]).toEqual([303, '/alerts/thanks']);
    const bad = await handleSubscribe(form({ email: 'nope', state: 'FL' }, h), ENV, asFetch(mockFetch(201)));
    expect([bad.status, bad.headers.get('location')]).toEqual([303, '/alerts/thanks?error=1']);
    const down = await handleSubscribe(form({ email: 'a@b.co', state: 'FL' }, h), ENV, asFetch(mockFetch(500)));
    expect(down.headers.get('location')).toBe('/alerts/thanks?error=1');
    const noenv = await handleSubscribe(form({ email: 'a@b.co', state: 'FL' }, h), {}, asFetch(mockFetch(201)));
    expect(noenv.headers.get('location')).toBe('/alerts/thanks?error=1');
  });
  it('form post without html accept gets JSON', async () => {
    const res = await handleSubscribe(form({ email: 'a@b.co', state: 'FL' }), ENV, asFetch(mockFetch(201)));
    expect(res.status).toBe(200);
  });
  it('honeypot: 200 no-op, no fetch (redirect for html)', async () => {
    const f = mockFetch(201);
    const j = await handleSubscribe(jsonReq({ email: 'a@b.co', state: 'FL', website: 'x' }), ENV, asFetch(f));
    expect(j.status).toBe(200);
    const h = await handleSubscribe(form({ email: 'a@b.co', state: 'FL', website: 'x' }, { accept: 'text/html' }), ENV, asFetch(f));
    expect(h.headers.get('location')).toBe('/alerts/thanks');
    expect(f).not.toHaveBeenCalled();
  });
  it('validation 400, missing env 503, upstream failure 502 (JSON)', async () => {
    expect((await handleSubscribe(jsonReq({ email: 'x', state: 'FL' }), ENV, asFetch(mockFetch(201)))).status).toBe(400);
    expect((await handleSubscribe(jsonReq({ email: 'a@b.co', state: 'TX' }), ENV, asFetch(mockFetch(201)))).status).toBe(400);
    const f = mockFetch(201);
    expect((await handleSubscribe(jsonReq({ email: 'a@b.co', state: 'FL' }), { SUPABASE_URL: ENV.SUPABASE_URL }, asFetch(f))).status).toBe(503);
    expect(f).not.toHaveBeenCalled();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await handleSubscribe(jsonReq({ email: 'a@b.co', state: 'FL' }), ENV, asFetch(mockFetch(500)))).status).toBe(502);
    const boom = vi.fn(async () => { throw new Error('network'); });
    const r = await handleSubscribe(jsonReq({ email: 'a@b.co', state: 'FL' }), ENV, asFetch(boom));
    expect(r.status).toBe(502);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('sb_publishable_test');
    spy.mockRestore();
  });
  it('403 for cross-origin posts, no fetch', async () => {
    const f = mockFetch(201);
    const res = await handleSubscribe(jsonReq({ email: 'a@b.co', state: 'FL' }, { origin: 'https://evil.example' }), ENV, asFetch(f));
    expect(res.status).toBe(403);
    expect(f).not.toHaveBeenCalled();
  });
  it('400 for unreadable bodies, unsupported content types and oversize bodies', async () => {
    expect((await handleSubscribe(post('{not json', 'application/json'), ENV, asFetch(mockFetch(201)))).status).toBe(400);
    expect((await handleSubscribe(post('hi', 'text/plain'), ENV, asFetch(mockFetch(201)))).status).toBe(400);
    expect((await handleSubscribe(post('[]', 'application/json'), ENV, asFetch(mockFetch(201)))).status).toBe(400);
    const big = post(JSON.stringify({ email: 'a@b.co', state: 'FL', pad: 'x'.repeat(5000) }), 'application/json');
    expect((await handleSubscribe(big, ENV, asFetch(mockFetch(201)))).status).toBe(400);
  });
});
