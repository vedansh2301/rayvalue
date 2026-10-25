import { describe, expect, it, vi } from 'vitest';
import { ESTIMATE_EMAIL_CONSENT_TEXT, ESTIMATE_EMAIL_CONSENT_VERSION } from '../leads/consent';
import { buildEstimateEmail, emailEnabled, sendEmail } from './email';
import { handleEstimateEmail } from './estimate';
import { handleQuoteConfig } from './quote-config';
import { handleServiced, lookupInstallers } from './installers';

const ORIGIN = 'https://rayvalue.com';
const ENV = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' };
const post = (o: unknown, h: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/estimate-email`, { method: 'POST', body: JSON.stringify(o), headers: { 'content-type': 'application/json', origin: ORIGIN, 'user-agent': 'UA/1', ...h } });
const asFetch = (f: unknown) => f as typeof fetch;
const snap = { payback: { likely: '14 years', low: '11.5 years', high: '16.5 years' }, upfront_cost: { likely: '$33,300', low: '$26,800', high: '$40,300' } };
const body = { email: ' Ana@Example.com ', consent: 'on', state: 'FL', source: 'results', estimate_snapshot: JSON.stringify(snap) };

function db(emailStatus = 200) {
  return vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('api.resend.com')) return new Response('{}', { status: emailStatus });
    if (init?.method === 'POST') return new Response('[{"id":"e1"}]', { status: 201 });
    if (init?.method === 'PATCH') return new Response('[{"id":"e1"}]', { status: 200 });
    throw new Error(`unexpected ${u}`);
  });
}
const inserted = (f: ReturnType<typeof db>) => JSON.parse(f.mock.calls.find(([u, i]) => String(u).includes('estimate_requests') && i?.method === 'POST')![1]!.body as string);

describe('handleEstimateEmail', () => {
  it('stores the request with consent evidence and, with no provider, leaves it pending without sending', async () => {
    const f = db();
    const res = await handleEstimateEmail(post(body, { 'x-forwarded-for': '203.0.113.9' }), ENV, asFetch(f));
    expect(await res.json()).toEqual({ ok: true, emailed: false });
    expect(inserted(f)).toMatchObject({
      email: 'ana@example.com',
      state: 'FL',
      source: 'results',
      nurture: true,
      consent_text: ESTIMATE_EMAIL_CONSENT_TEXT,
      consent_version: ESTIMATE_EMAIL_CONSENT_VERSION,
      consent_ip: '203.0.113.9',
      estimate_snapshot: snap,
    });
    expect(f.mock.calls.some(([u]) => String(u).includes('resend'))).toBe(false);
    expect(f.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(false); // stays 'pending'
  });
  it('sends through the provider when configured and marks the request sent', async () => {
    const f = db();
    const res = await handleEstimateEmail(post(body), { ...ENV, RESEND_API_KEY: 're_x', EMAIL_FROM: 'RayValue <e@rayvalue.com>' }, asFetch(f));
    expect(await res.json()).toEqual({ ok: true, emailed: true });
    const mail = JSON.parse(f.mock.calls.find(([u]) => String(u).includes('resend'))![1]!.body as string);
    expect(mail.to).toEqual(['ana@example.com']);
    expect(mail.text).toContain('14 years likely (11.5 years to 16.5 years)');
    const patch = f.mock.calls.find(([, i]) => i?.method === 'PATCH')!;
    expect(JSON.parse(patch[1]!.body as string)).toEqual({ email_status: 'sent' });
  });
  it('requires a valid email and the consent box; the client cannot supply consent text', async () => {
    const f = db();
    const res = await handleEstimateEmail(post({ ...body, email: 'nope', consent: '' }), ENV, asFetch(f));
    expect(res.status).toBe(400);
    expect(Object.keys((await res.json()).fieldErrors).sort()).toEqual(['consent', 'email']);
    expect(f).not.toHaveBeenCalled();
    const ok = db();
    await handleEstimateEmail(post({ ...body, consent_text: 'hi', consent_version: 'x' }), ENV, asFetch(ok));
    expect(inserted(ok).consent_text).toBe(ESTIMATE_EMAIL_CONSENT_TEXT);
  });
  it('renter without an estimate: enrolled, nothing to send (skipped)', async () => {
    const f = db();
    await handleEstimateEmail(post({ email: 'r@example.com', consent: 'on', source: 'renter' }), { ...ENV, RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.co' }, asFetch(f));
    expect(inserted(f)).toMatchObject({ source: 'renter', estimate_snapshot: null });
    expect(JSON.parse(f.mock.calls.find(([, i]) => i?.method === 'PATCH')![1]!.body as string)).toEqual({ email_status: 'skipped' });
  });
  it('honeypot, cross-origin and storage failure', async () => {
    const f = db();
    expect((await (await handleEstimateEmail(post({ ...body, website: 'x' }), ENV, asFetch(f))).json()).ok).toBe(true);
    expect(f).not.toHaveBeenCalled();
    expect((await handleEstimateEmail(post(body, { origin: 'https://evil.example' }), ENV, asFetch(f))).status).toBe(403);
    expect((await handleEstimateEmail(post(body), {}, asFetch(f))).status).toBe(502);
  });
});

describe('email adapter', () => {
  it('is disabled without both vars and sends nothing', async () => {
    const f = vi.fn();
    expect(emailEnabled({ RESEND_API_KEY: 'k' })).toBe(false);
    expect(await sendEmail({ RESEND_API_KEY: 'k' }, { to: 'a@b.co', subject: 's', text: 't' }, asFetch(f))).toBe('disabled');
    expect(f).not.toHaveBeenCalled();
  });
  it('reports provider failures', async () => {
    expect(await sendEmail({ RESEND_API_KEY: 'k', EMAIL_FROM: 'a@b.co' }, { to: 'a@b.co', subject: 's', text: 't' }, asFetch(db(500)))).toBe('failed');
  });
  it('builds a ranges-only plain text email; null without an estimate', () => {
    const m = buildEstimateEmail('a@b.co', snap, 'Florida')!;
    expect(m.text).toContain('Payback: 14 years likely (11.5 years to 16.5 years)');
    expect(m.text).toContain('https://rayvalue.com/calculator/florida');
    expect(m.text).toContain('No federal tax credit is applied');
    expect(m.text).toContain('https://rayvalue.com/privacy/request');
    expect(buildEstimateEmail('a@b.co', null, null)).toBeNull();
  });
});

describe('installers lookup and /api/serviced', () => {
  const env = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'pub' };
  const rpc = (names: unknown, status = 200) => vi.fn(async (_u: unknown, _i?: RequestInit) => new Response(JSON.stringify(names), { status }));
  it('calls the RPC with the anon key and returns names', async () => {
    const f = rpc(['Acme Solar LLC']);
    expect(await lookupInstallers(env, '33101', 'FL', asFetch(f))).toEqual(['Acme Solar LLC']);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://proj.supabase.co/rest/v1/rpc/installers_for_zip');
    expect((init!.headers as Record<string, string>).apikey).toBe('pub');
    expect(JSON.parse(init!.body as string)).toEqual({ p_zip: '33101', p_state: 'FL' });
  });
  it('null on failure or a malformed answer', async () => {
    expect(await lookupInstallers(env, '33101', 'FL', asFetch(rpc({}, 500)))).toBeNull();
    expect(await lookupInstallers(env, '33101', 'FL', asFetch(rpc([1, 2])))).toBeNull();
    expect(await lookupInstallers({}, '33101', 'FL', asFetch(rpc([])))).toBeNull();
  });
  it('handleServiced derives the state from the ZIP and reports coverage', async () => {
    const yes = await handleServiced(new Request(`${ORIGIN}/api/serviced?zip=33101`), env, asFetch(rpc(['A'])));
    expect(await yes.json()).toEqual({ ok: true, state: 'FL', serviced: true, installers: ['A'] });
    const no = await handleServiced(new Request(`${ORIGIN}/api/serviced?zip=90210`), env, asFetch(rpc([])));
    expect(await no.json()).toEqual({ ok: true, state: 'CA', serviced: false, installers: [] });
    expect((await handleServiced(new Request(`${ORIGIN}/api/serviced?zip=75001`), env, asFetch(rpc([])))).status).toBe(400);
  });
});

describe('/api/quote-config', () => {
  const env = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'pub', CALL_NUMBER: '305-201-0123' };
  const fakeDb = (hours: unknown[]) =>
    vi.fn(async (u: unknown) =>
      String(u).includes('/staffed_hours')
        ? new Response(JSON.stringify(hours), { status: 200 })
        : new Response(JSON.stringify([{ id: 'fpl', name: 'FPL' }, { id: 'teco', name: 'TECO' }]), { status: 200 }),
    );
  const get = (state: string) => new Request(`${ORIGIN}/api/quote-config?state=${state}`);
  const hours = { timezone: 'America/New_York', days: [1, 2, 3, 4, 5], open_time: '09:00:00', close_time: '17:00:00' };
  it('returns utilities and the call link data when number and hours exist', async () => {
    const res = await handleQuoteConfig(get('FL'), env, asFetch(fakeDb([hours])));
    expect(res.headers.get('cache-control')).toContain('s-maxage=300');
    expect(await res.json()).toEqual({ ok: true, utilities: [{ id: 'fpl', name: 'FPL' }, { id: 'teco', name: 'TECO' }], call: { tel: '+13052010123', display: '(305) 201-0123', hours } });
  });
  it('hides the call link without a configured number or without hours', async () => {
    expect((await (await handleQuoteConfig(get('FL'), { ...env, CALL_NUMBER: '{{CALL_NUMBER}}' }, asFetch(fakeDb([hours])))).json()).call).toBeNull();
    expect((await (await handleQuoteConfig(get('FL'), env, asFetch(fakeDb([])))).json()).call).toBeNull();
  });
  it('validates the state and fails closed on a database error', async () => {
    expect((await handleQuoteConfig(get('TX'), env, asFetch(fakeDb([])))).status).toBe(400);
    expect((await handleQuoteConfig(get('FL'), env, asFetch(vi.fn(async () => new Response('x', { status: 500 }))))).status).toBe(502);
  });
});
