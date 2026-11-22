import { describe, expect, it, vi } from 'vitest';
import type { GlobalSignup } from '../subscribe/global';
import { buildConfirmationEmail, buildReportEmail } from './global-email';
import { EMAIL_MIN_GAP_MS, confirmSubscription, processGlobalSignup, unsubscribeSubscriber } from './global-subscribe';
import { handleSubscribe } from './subscribe';

const ORIGIN = 'https://rayvalue.com';
const ENV = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SECRET_KEY: 'sk', SUPABASE_PUBLISHABLE_KEY: 'pk', RESEND_API_KEY: 're', EMAIL_FROM: 'RayValue <x@rayvalue.com>', SITE_URL: ORIGIN, NURTURE_MAILING_ADDRESS: '1 Example St' };
const V: GlobalSignup = { email: 'a@b.co', country: 'GB', region: 'gb-cap-london', topics: ['report', 'deadline_alerts'], locale: 'en', source: 'x', params: { bill: '90' } };
const NOW = new Date('2026-11-23T12:00:00Z');

type Call = { url: string; method: string; body: Record<string, unknown> | null };
/** A fake fetch that records calls and answers by URL + method. */
function fake(h: { insert?: () => Response; select?: Response; email?: Response; rpc?: Response }) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (u.includes('/rpc/rate_limit_hit')) return h.rpc ?? new Response('true', { status: 200 });
    if (u.includes('api.resend.com')) return h.email ?? new Response('{"id":"1"}', { status: 200 });
    if (u.includes('/email_suppressions')) return new Response('[{"email":"a@b.co"}]', { status: 201 });
    if (u.includes('/email_subscribers') && method === 'POST') return h.insert?.() ?? new Response('[{"id":"11111111-1111-1111-1111-111111111111"}]', { status: 201 });
    if (u.includes('/email_subscribers') && method === 'PATCH') return new Response('[{"id":"1"}]', { status: 200 });
    if (u.includes('/email_subscribers')) return h.select ?? new Response('[]', { status: 200 });
    return new Response('{}', { status: 404 });
  });
  return { f: f as unknown as typeof fetch, calls };
}
const conflict = () => new Response('{"code":"23505"}', { status: 409 });
const existing = (o: Record<string, unknown> = {}) =>
  new Response(JSON.stringify([{ id: '11111111-1111-1111-1111-111111111111', topics: ['report'], confirmed_at: null, unsubscribed_at: null, last_email_at: null, confirm_token: 'c'.repeat(43), unsubscribe_token: 'u'.repeat(43), ...o }]), { status: 200 });
const emails = (calls: Call[]) => calls.filter((c) => c.url.includes('resend'));

describe('processGlobalSignup', () => {
  it('stores a new signup unconfirmed with the consent version and sends the confirmation with the reopen link', async () => {
    const { f, calls } = fake({});
    expect(await processGlobalSignup(V, ENV, f, NOW)).toBe('ok');
    const insert = calls.find((c) => c.method === 'POST' && c.url.includes('/email_subscribers'))!.body!;
    expect(insert).toMatchObject({ email: 'a@b.co', country: 'GB', region: 'gb-cap-london', topics: ['report', 'deadline_alerts'], locale: 'en', consent_version: '2026-11-23.1', report_params: { bill: '90' } });
    expect(insert.consent_text).toContain('United Kingdom');
    expect(insert).not.toHaveProperty('confirmed_at');
    const mail = emails(calls);
    expect(mail).toHaveLength(1);
    const text = String(mail[0]!.body!.text);
    expect(text).toContain('/subscribe/confirm?t=');
    expect(text).toContain('/uk/solar-calculator?bill=90');
    expect(text).toContain('/unsubscribe?s=');
    expect(text).toContain('1 Example St');
  });

  it('reports unavailable (no fake success) when the email provider or the secret key is not configured', async () => {
    const { f } = fake({});
    expect(await processGlobalSignup(V, { ...ENV, RESEND_API_KEY: undefined }, f, NOW)).toBe('unavailable');
    expect(await processGlobalSignup(V, { ...ENV, SUPABASE_SECRET_KEY: undefined }, f, NOW)).toBe('unavailable');
  });

  it('errors when the provider or database fails', async () => {
    expect(await processGlobalSignup(V, ENV, fake({ email: new Response('no', { status: 500 }) }).f, NOW)).toBe('error');
    expect(await processGlobalSignup(V, ENV, fake({ insert: () => new Response('no', { status: 500 }) }).f, NOW)).toBe('error');
  });

  it('repeat sign-up of an unconfirmed address rotates the confirm link and re-sends', async () => {
    const { f, calls } = fake({ insert: conflict, select: existing() });
    expect(await processGlobalSignup(V, ENV, f, NOW)).toBe('ok');
    const patch = calls.find((c) => c.method === 'PATCH')!.body!;
    expect(patch).toMatchObject({ confirmed_at: null, unsubscribed_at: null, consent_version: '2026-11-23.1' });
    expect(patch.confirm_token).toBeTypeOf('string');
    expect(emails(calls)).toHaveLength(1);
  });

  it('does not email the same address twice within the minimum gap, and answers the same', async () => {
    const recent = new Date(NOW.getTime() - EMAIL_MIN_GAP_MS + 1000).toISOString();
    const { f, calls } = fake({ insert: conflict, select: existing({ last_email_at: recent }) });
    expect(await processGlobalSignup(V, ENV, f, NOW)).toBe('ok');
    expect(emails(calls)).toHaveLength(0);
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('a confirmed address asking for a new topic gets pending_topics and a confirmation, not an instant change', async () => {
    const { f, calls } = fake({ insert: conflict, select: existing({ confirmed_at: '2026-11-01T00:00:00Z', topics: ['report'] }) });
    expect(await processGlobalSignup({ ...V, topics: ['report', 'deadline_alerts'] }, ENV, f, NOW)).toBe('ok');
    const patch = calls.find((c) => c.method === 'PATCH')!.body!;
    expect(patch.pending_topics).toEqual(['deadline_alerts']);
    expect(patch).not.toHaveProperty('topics');
    expect(emails(calls)).toHaveLength(1);
  });

  it('a confirmed address asking for its report again just gets the report link', async () => {
    const { f, calls } = fake({ insert: conflict, select: existing({ confirmed_at: '2026-11-01T00:00:00Z', topics: ['report', 'deadline_alerts'] }) });
    expect(await processGlobalSignup({ ...V, topics: ['report'] }, ENV, f, NOW)).toBe('ok');
    expect(emails(calls)[0]!.body!.subject).toBe('Your RayValue estimate link');
  });

  it('an unsubscribed address that signs up again goes through a fresh double opt-in', async () => {
    const { f, calls } = fake({ insert: conflict, select: existing({ confirmed_at: '2026-10-01T00:00:00Z', unsubscribed_at: '2026-10-02T00:00:00Z' }) });
    expect(await processGlobalSignup(V, ENV, f, NOW)).toBe('ok');
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({ confirmed_at: null, unsubscribed_at: null });
  });
});

describe('confirm and unsubscribe', () => {
  const T = 'a'.repeat(43);
  it('confirms, merging pending topics', async () => {
    const { f, calls } = fake({ select: new Response(JSON.stringify([{ id: '1', topics: ['report'], pending_topics: ['deadline_alerts'], confirmed_at: null, last_email_at: NOW.toISOString() }]), { status: 200 }) });
    expect(await confirmSubscription(ENV, T, f, NOW)).toBe('ok');
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({ topics: ['report', 'deadline_alerts'], pending_topics: null, confirmed_at: NOW.toISOString() });
  });
  it('rejects malformed, unknown and expired tokens; repeating a confirmed link is fine', async () => {
    expect(await confirmSubscription(ENV, 'short', fake({}).f, NOW)).toBe('invalid');
    expect(await confirmSubscription(ENV, T, fake({ select: new Response('[]') }).f, NOW)).toBe('invalid');
    const old = new Date(NOW.getTime() - 8 * 86400000).toISOString();
    const row = (o: object) => new Response(JSON.stringify([{ id: '1', topics: ['report'], pending_topics: null, confirmed_at: null, last_email_at: old, ...o }]));
    expect(await confirmSubscription(ENV, T, fake({ select: row({}) }).f, NOW)).toBe('expired');
    expect(await confirmSubscription(ENV, T, fake({ select: row({ confirmed_at: '2026-11-01T00:00:00Z' }) }).f, NOW)).toBe('ok');
  });
  it('unsubscribe marks the row and adds the address to the shared suppression list', async () => {
    const { f, calls } = fake({ select: new Response('[{"id":"1","email":"a@b.co"}]', { status: 200 }) });
    expect(await unsubscribeSubscriber(ENV, T, f, NOW)).toBe('ok');
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({ unsubscribed_at: NOW.toISOString() });
    expect(calls.some((c) => c.url.includes('/email_suppressions'))).toBe(true);
    expect(await unsubscribeSubscriber(ENV, 'x', f, NOW)).toBe('invalid');
  });
});

describe('emails', () => {
  const input = {
    to: 'a@b.co',
    country: 'DE' as const,
    locale: 'de' as const,
    topics: ['report', 'deadline_alerts'] as const,
    confirmUrl: 'https://rayvalue.com/subscribe/confirm?t=x',
    unsubscribeUrl: 'https://rayvalue.com/unsubscribe?s=y',
    reportUrl: 'https://rayvalue.com/de/photovoltaik-rechner?bill=90',
    siteUrl: 'https://rayvalue.com',
    mailingAddress: null,
  };
  it('German confirmation is in German with links and one-click unsubscribe headers', () => {
    const m = buildConfirmationEmail(input);
    expect(m.subject).toContain('bestätigen');
    expect(m.text).toContain(input.confirmUrl);
    expect(m.text).toContain(input.reportUrl);
    expect(m.headers?.['List-Unsubscribe']).toBe(`<${input.unsubscribeUrl}>`);
  });
  it('never contains computed figures or a quote offer', () => {
    const en = { ...input, locale: 'en' as const, topics: ['deadline_alerts'] as const, reportUrl: null };
    for (const m of [buildConfirmationEmail(input), buildReportEmail(input), buildConfirmationEmail(en)]) {
      expect(m.text.replace(/https?:\/\/\S+/g, '')).not.toMatch(/[€£$]\s?\d|\d\s?(€|£|Jahre|years)/);
    }
  });
});

describe('POST /api/subscribe (global branch)', () => {
  const post = (body: unknown, h: Record<string, string> = {}) =>
    new Request(`${ORIGIN}/api/subscribe`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': '1.2.3.4', ...h } });
  const ok = { email: 'a@b.co', country: 'DE', topics: ['report'], consent: true, source: 'de-calculator' };
  it('200 for a valid request, 400 for each missing requirement, same-origin only', async () => {
    const { f } = fake({});
    expect((await handleSubscribe(post(ok), ENV, f)).status).toBe(200);
    expect((await handleSubscribe(post({ ...ok, consent: false }), ENV, f)).status).toBe(400);
    expect((await handleSubscribe(post({ ...ok, country: 'FR' }), ENV, f)).status).toBe(400);
    expect((await handleSubscribe(post({ ...ok, region: 'xx' }), ENV, f)).status).toBe(400);
    expect((await handleSubscribe(post({ ...ok, topics: [] }), ENV, f)).status).toBe(400);
    expect((await handleSubscribe(post(ok, { origin: 'https://evil.example' }), ENV, f)).status).toBe(403);
  });
  it('429 when the rate limit says so; 503 without a provider; the response never reveals an existing address', async () => {
    expect((await handleSubscribe(post(ok), ENV, fake({ rpc: new Response('false', { status: 200 }) }).f)).status).toBe(429);
    expect((await handleSubscribe(post(ok), { ...ENV, RESEND_API_KEY: undefined }, fake({}).f)).status).toBe(503);
    const a = await (await handleSubscribe(post(ok), ENV, fake({}).f)).text();
    const b = await (await handleSubscribe(post(ok), ENV, fake({ insert: conflict, select: existing({ confirmed_at: '2026-11-01T00:00:00Z', topics: ['report'] }) }).f)).text();
    expect(a).toBe(b);
  });
  it('the legacy FL/CA body still takes the old path', async () => {
    const f = vi.fn(async (_u: unknown, _i?: RequestInit) => new Response(null, { status: 201 }));
    const res = await handleSubscribe(post({ email: 'a@b.co', state: 'FL' }), ENV, f as unknown as typeof fetch);
    expect(res.status).toBe(200);
    expect(String(f.mock.calls[0]![0])).toContain('/rate_alert_subscribers');
  });
});
