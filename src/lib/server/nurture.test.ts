import { describe, expect, it } from 'vitest';
import { runNurture, nurtureMissing, type NurtureEnv } from './nurture';
import { signUnsubscribeToken, verifyUnsubscribeToken, applyUnsubscribe } from './unsubscribe';

const SECRET = 'a-long-test-secret-value';
const env: NurtureEnv = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SECRET_KEY: 'sk',
  RESEND_API_KEY: 're',
  EMAIL_FROM: 'RayValue <a@b.c>',
  NURTURE_ENABLED: 'true',
  NURTURE_MAILING_ADDRESS: '1 Example St, Town',
  UNSUBSCRIBE_SECRET: SECRET,
};
const now = new Date('2026-11-10T15:00:00Z');
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ID3 = '33333333-3333-4333-8333-333333333333';

function mock(tables: Record<string, unknown[]>) {
  const sent: { to: string[]; text: string; headers?: Record<string, string> }[] = [];
  const patches: { url: string; body: unknown }[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    if (u.hostname === 'api.resend.com') {
      sent.push(JSON.parse(String(init?.body)));
      return new Response('{}', { status: 200 });
    }
    const table = u.pathname.split('/').pop()!;
    if (init?.method === 'PATCH') {
      patches.push({ url: u.toString(), body: JSON.parse(String(init.body)) });
      return new Response('[{"id":"x"}]', { status: 200 });
    }
    return new Response(JSON.stringify(tables[table] ?? []), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, sent, patches };
}

const est = (id: string, email: string, ageDays: number, over = {}) => ({
  id, email, state: 'FL', estimate_snapshot: null, created_at: new Date(now.getTime() - ageDays * 86_400_000).toISOString(),
  nurture_step: 0, nurture_last_sent_at: null, email_status: 'sent', ...over,
});

describe('unsubscribe tokens', () => {
  it('round-trips and rejects tampering', () => {
    const t = signUnsubscribeToken('e', ID1, SECRET);
    expect(verifyUnsubscribeToken(t, SECRET)).toEqual({ kind: 'e', id: ID1 });
    expect(verifyUnsubscribeToken(t.replace('e.', 'l.'), SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(t + 'x', SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(t, 'another-long-secret-value')).toBeNull();
    expect(verifyUnsubscribeToken(t, undefined)).toBeNull();
    expect(verifyUnsubscribeToken('garbage', SECRET)).toBeNull();
  });
  it('records the opt-out in the suppression table', async () => {
    const calls: { method: string; path: string; body?: string }[] = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const u = new URL(String(input));
      calls.push({ method: init?.method ?? 'GET', path: u.pathname, body: init?.body as string | undefined });
      if ((init?.method ?? 'GET') === 'GET') return new Response('[{"email":"Pat@Example.com"}]', { status: 200 });
      return new Response('[{"email":"pat@example.com"}]', { status: 201 });
    }) as typeof fetch;
    const r = await applyUnsubscribe({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SECRET_KEY: 'sk', UNSUBSCRIBE_SECRET: SECRET }, signUnsubscribeToken('e', ID1, SECRET), fetchImpl);
    expect(r).toBe('ok');
    const ins = calls.find((c) => c.method === 'POST')!;
    expect(ins.path).toContain('email_suppressions');
    expect(JSON.parse(ins.body!)).toMatchObject({ email: 'pat@example.com', reason: 'unsubscribe' });
    expect(await applyUnsubscribe({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SECRET_KEY: 'sk', UNSUBSCRIBE_SECRET: SECRET }, 'bad', fetchImpl)).toBe('invalid');
  });
});

describe('runNurture', () => {
  it('is disabled and lists what is missing unless fully configured', async () => {
    expect(nurtureMissing({})).toEqual(expect.arrayContaining(['NURTURE_ENABLED=true', 'NURTURE_MAILING_ADDRESS']));
    const m = mock({});
    const out = await runNurture({ ...env, NURTURE_MAILING_ADDRESS: '' }, m.fetchImpl, now);
    expect(out.disabled).toEqual(['NURTURE_MAILING_ADDRESS']);
    expect(m.sent).toHaveLength(0);
  });
  it('sends the due email with unsubscribe link and headers, and records the step', async () => {
    const m = mock({ estimate_requests: [est(ID1, 'a@example.com', 2.5)] });
    const out = await runNurture(env, m.fetchImpl, now);
    expect(out).toMatchObject({ sent: 1, failed: 0 });
    expect(m.sent[0]!.to).toEqual(['a@example.com']);
    expect(m.sent[0]!.text).toContain('RayValue, 1 Example St, Town');
    expect(m.sent[0]!.text).not.toContain('{{');
    expect(m.sent[0]!.headers!['List-Unsubscribe']).toMatch(/unsubscribe\?t=e\./);
    expect(m.patches[0]!.body).toMatchObject({ nurture_step: 2 });
  });
  it('skips suppressed, delete/do-not-sell, not-yet-due, and duplicate addresses', async () => {
    const m = mock({
      estimate_requests: [est(ID1, 'sup@example.com', 3), est(ID2, 'dns@example.com', 3), est(ID3, 'new@example.com', 0.5), est('44444444-4444-4444-8444-444444444444', 'ok@example.com', 3), est('55555555-5555-4555-8555-555555555555', 'OK@example.com', 3)],
      email_suppressions: [{ email: 'SUP@example.com' }],
      data_requests: [{ email: 'dns@example.com' }],
    });
    const out = await runNurture(env, m.fetchImpl, now);
    expect(out.sent).toBe(1);
    expect(m.sent.map((s) => s.to[0])).toEqual(['ok@example.com']);
  });
  it('includes nurture leads only when NURTURE_INCLUDE_LEADS=true', async () => {
    const tables = { leads: [est(ID1, 'lead@example.com', 0.1, { email_status: undefined })] };
    expect((await runNurture(env, mock(tables).fetchImpl, now)).sent).toBe(0);
    const m = mock(tables);
    expect((await runNurture({ ...env, NURTURE_INCLUDE_LEADS: 'true' }, m.fetchImpl, now)).sent).toBe(1);
    expect(m.sent[0]!.text).toContain('estimate');
  });
  it('sends nothing if a read fails (cannot check opt-outs)', async () => {
    const fetchImpl = (async () => new Response('x', { status: 500 })) as typeof fetch;
    expect(await runNurture(env, fetchImpl, now)).toEqual({ error: 'database read failed' });
  });
});
