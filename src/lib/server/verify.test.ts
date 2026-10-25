import { describe, expect, it, vi } from 'vitest';
import { MAX_CHECKS, MAX_SENDS, handleVerify, signLeadToken, verificationEnabled } from './verify';

const ENV = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  TWILIO_ACCOUNT_SID: 'ACtest',
  TWILIO_AUTH_TOKEN: 'authtok',
  TWILIO_VERIFY_SERVICE_SID: 'VAtest',
  LEAD_SIGNING_SECRET: 'signing',
};
const ID = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-10-26T12:00:00Z');
const ORIGIN = 'https://rayvalue.com';
const post = (o: unknown, h: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/leads/verify`, { method: 'POST', body: JSON.stringify(o), headers: { 'content-type': 'application/json', origin: ORIGIN, ...h } });
const token = (id = ID) => signLeadToken('signing', id, NOW);

interface Row { phone: string; phone_verified: boolean; verify_sends: number; verify_checks: number; verify_last_sent_at: string | null }
const baseRow: Row = { phone: '+13052010123', phone_verified: false, verify_sends: 0, verify_checks: 0, verify_last_sent_at: null };

/** Fetch double for Supabase (select/patch) and Twilio. */
function world(row: Row = baseRow, opts: { twilioCheck?: string; twilioSendStatus?: number; patchRows?: number } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.startsWith('https://proj.supabase.co') && (init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify([{ id: ID, ...row }]), { status: 200 });
    if (u.startsWith('https://proj.supabase.co') && init?.method === 'PATCH') return new Response(JSON.stringify(Array(opts.patchRows ?? 1).fill({ id: ID })), { status: 200 });
    if (u.endsWith('/Verifications')) return new Response('{}', { status: opts.twilioSendStatus ?? 201 });
    if (u.endsWith('/VerificationCheck')) return new Response(JSON.stringify({ status: opts.twilioCheck ?? 'approved' }), { status: 200 });
    throw new Error(`unexpected ${u}`);
  });
  return { f: f as unknown as typeof fetch, calls };
}
const patches = (calls: { url: string; init?: RequestInit }[]) => calls.filter((c) => c.init?.method === 'PATCH').map((c) => JSON.parse(c.init!.body as string));

describe('verificationEnabled', () => {
  it('needs all Twilio vars, the signing secret and the secret key', () => {
    expect(verificationEnabled(ENV)).toBe(true);
    for (const k of Object.keys(ENV)) expect(verificationEnabled({ ...ENV, [k]: undefined }), k).toBe(false);
  });
});

describe('handleVerify', () => {
  it('is unavailable (503) when Twilio is not configured', async () => {
    const res = await handleVerify(post({ lead_id: ID, token: token(), action: 'send' }), { ...ENV, TWILIO_AUTH_TOKEN: undefined }, world().f, [], NOW);
    expect(res.status).toBe(503);
  });
  it('rejects a bad, expired or other-lead token', async () => {
    const w = world();
    for (const t of ['x', token('22222222-2222-4222-8222-222222222222'), signLeadToken('signing', ID, NOW - 31 * 60_000)]) {
      expect((await handleVerify(post({ lead_id: ID, token: t, action: 'send' }), ENV, w.f, [], NOW)).status).toBe(403);
    }
    expect(w.calls).toHaveLength(0);
  });
  it('rejects cross-origin requests', async () => {
    expect((await handleVerify(post({ lead_id: ID, token: token(), action: 'send' }, { origin: 'https://evil.example' }), ENV, world().f, [], NOW)).status).toBe(403);
  });

  it('send: counts the send, texts the phone stored with the lead (never one from the client)', async () => {
    const w = world();
    const res = await handleVerify(post({ lead_id: ID, token: token(), action: 'send', phone: '+19999999999' }), ENV, w.f, [], NOW);
    expect(await res.json()).toEqual({ ok: true, sent: true, retry_after: 30, sends_left: 2 });
    expect(patches(w.calls)[0]).toMatchObject({ verify_sends: 1 });
    const tw = w.calls.find((c) => c.url.endsWith('/Verifications'))!;
    expect(String(tw.init!.body)).toContain('To=%2B13052010123');
    expect(String(tw.init!.body)).not.toContain('9999999999');
    expect((tw.init!.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('ACtest:authtok').toString('base64')}`);
  });
  it('send: 30 second spacing and at most 3 codes', async () => {
    const recent = world({ ...baseRow, verify_sends: 1, verify_last_sent_at: new Date(NOW - 10_000).toISOString() });
    const r1 = await handleVerify(post({ lead_id: ID, token: token(), action: 'send' }), ENV, recent.f, [], NOW);
    expect(r1.status).toBe(429);
    expect((await r1.json()).retry_after).toBe(20);
    expect(recent.calls.some((c) => c.url.endsWith('/Verifications'))).toBe(false);

    const later = world({ ...baseRow, verify_sends: 1, verify_last_sent_at: new Date(NOW - 31_000).toISOString() });
    expect((await handleVerify(post({ lead_id: ID, token: token(), action: 'send' }), ENV, later.f, [], NOW)).status).toBe(200);

    const maxed = world({ ...baseRow, verify_sends: MAX_SENDS, verify_last_sent_at: new Date(NOW - 60_000).toISOString() });
    expect((await handleVerify(post({ lead_id: ID, token: token(), action: 'send' }), ENV, maxed.f, [], NOW)).status).toBe(429);
    expect(maxed.calls.some((c) => c.url.endsWith('/Verifications'))).toBe(false);
  });
  it('send: a lost compare-and-set (parallel request) does not send', async () => {
    const w = world(baseRow, { patchRows: 0 });
    expect((await handleVerify(post({ lead_id: ID, token: token(), action: 'send' }), ENV, w.f, [], NOW)).status).toBe(429);
    expect(w.calls.some((c) => c.url.endsWith('/Verifications'))).toBe(false);
  });
  it('send: Twilio failure -> 502 with a skip hint', async () => {
    const res = await handleVerify(post({ lead_id: ID, token: token(), action: 'send' }), ENV, world(baseRow, { twilioSendStatus: 500 }).f, [], NOW);
    expect(res.status).toBe(502);
  });

  it('check: an approved code sets phone_verified on the server', async () => {
    const w = world();
    const res = await handleVerify(post({ lead_id: ID, token: token(), action: 'check', code: '123456', phone_verified: true }), ENV, w.f, [], NOW);
    expect(await res.json()).toMatchObject({ ok: true, verified: true });
    expect(patches(w.calls)).toEqual([{ verify_checks: 1 }, { phone_verified: true }]);
  });
  it('check: a wrong code is counted and does not verify', async () => {
    const w = world(baseRow, { twilioCheck: 'pending' });
    const res = await handleVerify(post({ lead_id: ID, token: token(), action: 'check', code: '000000' }), ENV, w.f, [], NOW);
    expect(await res.json()).toEqual({ ok: true, verified: false, attempts_left: MAX_CHECKS - 1 });
    expect(patches(w.calls)).toEqual([{ verify_checks: 1 }]);
  });
  it('check: the client flag is ignored; only Twilio approval counts; attempts are capped', async () => {
    const maxed = world({ ...baseRow, verify_checks: MAX_CHECKS });
    expect((await handleVerify(post({ lead_id: ID, token: token(), action: 'check', code: '123456' }), ENV, maxed.f, [], NOW)).status).toBe(429);
    expect(maxed.calls.some((c) => c.url.endsWith('/VerificationCheck'))).toBe(false);
    const bad = world();
    expect((await handleVerify(post({ lead_id: ID, token: token(), action: 'check', code: 'abc' }), ENV, bad.f, [], NOW)).status).toBe(400);
  });
  it('already verified -> ok without calling Twilio', async () => {
    const w = world({ ...baseRow, phone_verified: true });
    const res = await handleVerify(post({ lead_id: ID, token: token(), action: 'send' }), ENV, w.f, [], NOW);
    expect(await res.json()).toMatchObject({ ok: true, verified: true });
    expect(w.calls.some((c) => c.url.includes('twilio'))).toBe(false);
  });
});
