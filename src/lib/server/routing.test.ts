import { describe, expect, it, vi } from 'vitest';
import { verifySignature, type LeadRecord } from '../routing/delivery';
import type { Buyer } from '../routing/eligibility';
import { checkDuplicate, checkSuppressed, newLeadMessage, processDelivery, readEnvRef, retryDueDeliveries, routeLead, type RoutingEnv } from './routing';
import { runInBackground } from './background';
import { allowRequest, rateLimitKey } from './rate-limit';

const NOW = new Date('2026-10-26T15:00:00Z'); // Monday 11:00 New York
const lead: LeadRecord & { status: string } = {
  id: '11111111-1111-4111-8111-111111111111', created_at: NOW.toISOString(), status: 'new',
  first_name: 'Ana', last_name: 'Diaz', email: 'ana@example.com', phone: '+13052010123', phone_verified: false, street_address: '123 Palm Ave',
  zip: '33101', state: 'FL', utility_id: 'fpl', bill_bucket: '200_300', avg_monthly_bill: 250, homeowner: true, roof_age: '10_20', shading: 'some', battery: null,
  battery_interest: 'no', pay_method: 'cash', timeline: 'asap', estimate_snapshot: null, source: 'results', utm_source: 'google', utm_medium: null, utm_campaign: null,
  utm_term: null, utm_content: null, gclid: null, fbclid: null, landing_page: null, referrer: null, consent_text: 'T', consent_version: 'v1', consent_at: NOW.toISOString(),
  consent_ip: '1.2.3.4', consent_page_url: null, trustedform_cert_url: 'https://cert.trustedform.com/0123456789abcdef0123456789abcdef01234567', consented_installers: ['Acme LLC', 'Bright LLC', 'Test Buyer (not a real installer)'],
};
const buyer = (o: Partial<Buyer> & { id: string }): Buyer => ({
  created_at: '2026-01-01T00:00:00Z', name: o.id, legal_name: o.id === 'acme' ? 'Acme LLC' : o.id === 'bright' ? 'Bright LLC' : `${o.id} LLC`, states: ['FL'], zips: [], active: true,
  accepted_timelines: ['asap'], min_bill_bucket: null, homeowner_only: true, exclusive: false, daily_cap: null, price: null, delivery_method: 'webhook',
  delivery_target: 'https://crm.acme-test.example/hook', delivery_target_env: null, webhook_secret_env: 'ACME_HOOK_SECRET', fallback_email_env: null, business_hours: null, ...o,
});
const SECRETS = { ACME_HOOK_SECRET: 'whsec_test', TEST_BUYER_EMAIL: 'buyer@example.com', SUPABASE_SECRET_KEY: 'nope' };
const ENV: RoutingEnv = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SECRET_KEY: 'k', RESEND_API_KEY: 'r', EMAIL_FROM: 'RayValue <a@rayvalue.com>', OWNER_EMAIL: 'owner@example.com', secrets: SECRETS };
const noSleep = async () => {};

interface Db {
  buyers: Buyer[];
  deliveriesToday: { buyer_id: string; status: string }[];
  patches: { table: string; filter: string; body: Record<string, unknown> }[];
  inserts: { table: string; body: Record<string, unknown> }[];
  webhooks: { url: string; headers: Record<string, string>; body: string }[];
  emails: { to: string[]; subject: string; text: string }[];
}
function world(opts: { buyers: Buyer[]; hook?: (n: number) => number; deliveriesToday?: Db['deliveriesToday']; dueRows?: unknown[] }) {
  const db: Db = { buyers: opts.buyers, deliveriesToday: opts.deliveriesToday ?? [], patches: [], inserts: [], webhooks: [], emails: [] };
  let hookCalls = 0;
  let n = 0;
  const f = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? 'GET';
    if (u.hostname === 'api.resend.com') {
      db.emails.push(JSON.parse(init!.body as string));
      return new Response('{}', { status: 200 });
    }
    if (u.hostname === 'crm.acme-test.example') {
      hookCalls++;
      db.webhooks.push({ url: String(url), headers: init!.headers as Record<string, string>, body: init!.body as string });
      const status = opts.hook ? opts.hook(hookCalls) : 200;
      return new Response(status === 200 ? '{"ok":true}' : 'nope', { status });
    }
    const table = u.pathname.split('/').pop()!;
    if (method === 'GET') {
      if (table === 'leads') return new Response(JSON.stringify(u.searchParams.get('id') ? [lead] : []), { status: 200 });
      if (table === 'buyers') return new Response(JSON.stringify(u.searchParams.get('id') ? db.buyers.filter((b) => `eq.${b.id}` === u.searchParams.get('id')) : db.buyers.filter((b) => b.active)), { status: 200 });
      if (table === 'lead_deliveries') return new Response(JSON.stringify(u.searchParams.get('status') ? (opts.dueRows ?? []) : db.deliveriesToday), { status: 200 });
    }
    if (method === 'POST') {
      const body = JSON.parse(init!.body as string);
      db.inserts.push({ table, body });
      return new Response(JSON.stringify([{ id: `d${++n}`, lead_id: body.lead_id, buyer_id: body.buyer_id, method: body.method, status: 'queued', attempts: 0 }]), { status: 201 });
    }
    if (method === 'PATCH') {
      db.patches.push({ table, filter: u.search, body: JSON.parse(init!.body as string) });
      return new Response('[{"id":"x"}]', { status: 200 });
    }
    throw new Error(`unexpected ${method} ${u}`);
  });
  return { f: f as unknown as typeof fetch, db };
}
const leadPatch = (db: Db) => db.patches.filter((p) => p.table === 'leads').at(-1)!.body;

describe('readEnvRef', () => {
  it('resolves plain names; refuses malformed names and our own credentials', () => {
    expect(readEnvRef(SECRETS, 'ACME_HOOK_SECRET')).toBe('whsec_test');
    expect(readEnvRef(SECRETS, 'SUPABASE_SECRET_KEY')).toBeUndefined();
    expect(readEnvRef({ ADMIN_PASSWORD: 'x' }, 'ADMIN_PASSWORD')).toBeUndefined();
    expect(readEnvRef(SECRETS, 'lowercase')).toBeUndefined();
    expect(readEnvRef(SECRETS, 'NOT_SET')).toBeUndefined();
    expect(readEnvRef(SECRETS, null)).toBeUndefined();
  });
});

describe('routeLead', () => {
  it('delivers a signed webhook (with consent evidence), records it and marks the lead sent', async () => {
    const { f, db } = world({ buyers: [buyer({ id: 'acme' })] });
    const summary = await routeLead(ENV, lead.id, f, NOW, noSleep);
    expect(db.webhooks).toHaveLength(1);
    const w = db.webhooks[0]!;
    expect(verifySignature('whsec_test', w.body, w.headers['X-RayValue-Signature']!, Date.now())).toBe(true);
    const payload = JSON.parse(w.body);
    expect(payload.consent).toMatchObject({ version: 'v1', trustedform_cert_url: lead.trustedform_cert_url });
    expect(w.headers['X-RayValue-Delivery-Id']).toBe('d1');
    expect(db.inserts[0]).toMatchObject({ table: 'lead_deliveries', body: { lead_id: lead.id, method: 'webhook' } });
    expect(db.patches.find((p) => p.table === 'lead_deliveries')!.body).toMatchObject({ status: 'delivered', attempts: 1, response_status: 200 });
    expect(leadPatch(db)).toMatchObject({ status: 'sent', status_reason: null });
    expect(summary).toMatchObject({ status: 'sent', buyers: ['acme'] });
  });

  it('sends to at most 3 buyers; an exclusive top buyer gets it alone', async () => {
    const many = ['acme', 'bright', 'c', 'd'].map((id) => buyer({ id, legal_name: id === 'acme' ? 'Acme LLC' : id === 'bright' ? 'Bright LLC' : `${id} LLC` }));
    const l3 = { ...lead, consented_installers: ['Acme LLC', 'Bright LLC', 'c LLC', 'd LLC'] };
    const w = world({ buyers: many });
    // reuse the world but with a lead consenting to four
    const f2 = vi.fn(async (u: unknown, i?: RequestInit) => (String(u).includes('/rest/v1/leads') && (i?.method ?? 'GET') === 'GET' ? new Response(JSON.stringify([l3]), { status: 200 }) : (w.f as typeof fetch)(u as string, i)));
    await routeLead(ENV, lead.id, f2 as unknown as typeof fetch, NOW, noSleep);
    expect(w.db.inserts).toHaveLength(3);
    const ex = world({ buyers: [buyer({ id: 'acme', exclusive: true, price: 50 }), buyer({ id: 'bright', price: 20 })] });
    await routeLead(ENV, lead.id, ex.f, NOW, noSleep);
    expect(ex.db.inserts).toHaveLength(1);
  });

  it('respects the buyer daily cap and consent: no eligible buyer -> status stays new with a reason', async () => {
    const capped = world({ buyers: [buyer({ id: 'acme', daily_cap: 1 })], deliveriesToday: [{ buyer_id: 'acme', status: 'delivered' }] });
    expect(await routeLead(ENV, lead.id, capped.f, NOW, noSleep)).toMatchObject({ status: 'new', reason: 'no_eligible_buyer' });
    expect(capped.db.webhooks).toHaveLength(0);
    const unconsented = world({ buyers: [buyer({ id: 'zzz' })] });
    await routeLead(ENV, lead.id, unconsented.f, NOW, noSleep);
    expect(unconsented.db.webhooks).toHaveLength(0);
  });

  it('retries 5xx with backoff, then succeeds', async () => {
    const sleeps: number[] = [];
    const { f, db } = world({ buyers: [buyer({ id: 'acme' })], hook: (n) => (n < 3 ? 503 : 200) });
    await routeLead(ENV, lead.id, f, NOW, async (ms) => void sleeps.push(ms));
    expect(db.webhooks).toHaveLength(3);
    expect(sleeps).toEqual([1000, 3000]);
    expect(db.patches.find((p) => p.table === 'lead_deliveries')!.body).toMatchObject({ status: 'delivered', attempts: 3 });
  });

  it('keeps failing: schedules a retry, logs the response, leaves the lead new, alerts the owner', async () => {
    const { f, db } = world({ buyers: [buyer({ id: 'acme' })], hook: () => 500 });
    const s = await routeLead(ENV, lead.id, f, NOW, noSleep);
    const d = db.patches.find((p) => p.table === 'lead_deliveries')!.body;
    expect(d).toMatchObject({ status: 'failed', attempts: 3, response_status: 500, response_excerpt: 'nope' });
    expect(typeof d.next_attempt_at).toBe('string');
    expect(leadPatch(db)).toMatchObject({ status: 'new', status_reason: 'delivery_failed' });
    expect(s?.status).toBe('new');
    expect(db.emails.some((e) => e.subject.includes('failed, will retry') && e.to[0] === 'owner@example.com')).toBe(true);
  });

  it('a 4xx from the buyer is permanent: no retries, abandoned, owner alerted', async () => {
    const { f, db } = world({ buyers: [buyer({ id: 'acme' })], hook: () => 422 });
    await routeLead(ENV, lead.id, f, NOW, noSleep);
    expect(db.webhooks).toHaveLength(1);
    expect(db.patches.find((p) => p.table === 'lead_deliveries')!.body).toMatchObject({ status: 'abandoned' });
    expect(db.emails.some((e) => e.subject.includes('FAILED permanently'))).toBe(true);
  });

  it('falls back to the buyer\'s email when the webhook fails (fallback address from an env var)', async () => {
    const { f, db } = world({ buyers: [buyer({ id: 'acme', fallback_email_env: 'TEST_BUYER_EMAIL' })], hook: () => 500 });
    await routeLead(ENV, lead.id, f, NOW, noSleep);
    const mail = db.emails.find((e) => e.to[0] === 'buyer@example.com')!;
    expect(mail.text).toContain('Consent version: v1');
    expect(mail.text).toContain('cert.trustedform.com');
    expect(db.patches.find((p) => p.table === 'lead_deliveries')!.body).toMatchObject({ status: 'delivered', used_fallback: true });
    expect(leadPatch(db).status).toBe('sent');
  });

  it('email buyer: target comes from the env var named on the row (TEST_BUYER_EMAIL)', async () => {
    const { f, db } = world({ buyers: [buyer({ id: 'acme', delivery_method: 'email', delivery_target: null, delivery_target_env: 'TEST_BUYER_EMAIL', webhook_secret_env: null })] });
    await routeLead(ENV, lead.id, f, NOW, noSleep);
    expect(db.webhooks).toHaveLength(0);
    expect(db.emails.filter((e) => e.to[0] === 'buyer@example.com')).toHaveLength(1);
    expect(leadPatch(db).status).toBe('sent');
  });

  it('misconfigured webhook (secret env var unset) is not sent unsigned', async () => {
    const { f, db } = world({ buyers: [buyer({ id: 'acme', webhook_secret_env: 'MISSING_SECRET' })] });
    await routeLead(ENV, lead.id, f, NOW, noSleep);
    expect(db.webhooks).toHaveLength(0);
    expect(db.patches.find((p) => p.table === 'lead_deliveries')!.body).toMatchObject({ status: 'abandoned', error: 'webhook secret env var not set' });
  });

  it('outside the buyer\'s business hours the delivery is queued, not sent', async () => {
    const hours = { timezone: 'America/New_York', days: [1, 2, 3, 4, 5], open: '09:00', close: '17:00' };
    const { f, db } = world({ buyers: [buyer({ id: 'acme', business_hours: hours })] });
    const s = await routeLead(ENV, lead.id, f, new Date('2026-10-26T23:00:00Z'), noSleep);
    expect(db.webhooks).toHaveLength(0);
    expect(db.inserts[0]!.body).toMatchObject({ status: 'queued' });
    expect(s?.status).toBe('sent');
  });

  it('does nothing for a lead that is not status new', async () => {
    const { f, db } = world({ buyers: [buyer({ id: 'acme' })] });
    const f2 = vi.fn(async (u: unknown, i?: RequestInit) => (String(u).includes('/rest/v1/leads') ? new Response(JSON.stringify([{ ...lead, status: 'duplicate' }]), { status: 200 }) : (f as typeof fetch)(u as string, i)));
    await routeLead(ENV, lead.id, f2 as unknown as typeof fetch, NOW, noSleep);
    expect(db.webhooks).toHaveLength(0);
  });
});

describe('retryDueDeliveries', () => {
  it('re-sends due deliveries once and marks the lead sent', async () => {
    const due = [{ id: 'dx', lead_id: lead.id, buyer_id: 'acme', method: 'webhook', status: 'failed', attempts: 3 }];
    const { f, db } = world({ buyers: [buyer({ id: 'acme' })], dueRows: due });
    const r = await retryDueDeliveries(ENV, f, NOW);
    expect(r).toEqual({ checked: 1, delivered: 1 });
    expect(db.webhooks).toHaveLength(1);
    expect(db.patches.some((p) => p.table === 'leads' && p.body.status === 'sent')).toBe(true);
  });
  it('leaves deliveries alone while the buyer is closed', async () => {
    const due = [{ id: 'dx', lead_id: lead.id, buyer_id: 'acme', method: 'webhook', status: 'queued', attempts: 0 }];
    const hours = { timezone: 'America/New_York', days: [1], open: '09:00', close: '17:00' };
    const { f, db } = world({ buyers: [buyer({ id: 'acme', business_hours: hours })], dueRows: due });
    await retryDueDeliveries(ENV, f, new Date('2026-10-26T23:00:00Z'));
    expect(db.webhooks).toHaveLength(0);
  });
  it('stops at the attempt cap', async () => {
    const due = [{ id: 'dx', lead_id: lead.id, buyer_id: 'acme', method: 'webhook', status: 'failed', attempts: 8 }];
    const { f, db } = world({ buyers: [buyer({ id: 'acme' })], dueRows: due });
    await retryDueDeliveries(ENV, f, NOW);
    expect(db.webhooks).toHaveLength(0);
    expect(db.patches.some((p) => p.body.status === 'abandoned')).toBe(true);
  });
});

describe('processDelivery single attempt', () => {
  it('does not sleep on a non-inline attempt', async () => {
    const { f } = world({ buyers: [] });
    const sleep = vi.fn(noSleep);
    await processDelivery(ENV, { id: 'd', lead_id: lead.id, buyer_id: 'acme', method: 'webhook', status: 'failed', attempts: 3 }, buyer({ id: 'acme' }), lead, f, { inline: false, now: NOW, sleep });
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('checkDuplicate / checkSuppressed', () => {
  const respond = (rows: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(rows), { status })) as unknown as typeof fetch;
  it('finds a recent prior lead with the same phone or email', async () => {
    const f = respond([{ id: 'p1', created_at: '2026-10-20T00:00:00Z', status: 'sent', phone: '+13052010123', email: 'other@x.co' }]);
    expect(await checkDuplicate(ENV, { phone: '+13052010123', email: 'ana@example.com' }, f, NOW)).toEqual({ kind: 'duplicate', of: 'p1' });
    const url = new URL(String((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]));
    expect(url.searchParams.get('or')).toBe('(phone.eq.+13052010123,email.eq.ana@example.com)');
    expect(url.searchParams.get('created_at')).toBe('gte.2026-09-26T15:00:00.000Z');
  });
  it('unique when nothing matches; unknown when the query fails', async () => {
    expect(await checkDuplicate(ENV, { phone: '+13052010123', email: 'a@x.co' }, respond([]), NOW)).toEqual({ kind: 'unique' });
    expect(await checkDuplicate(ENV, { phone: '+13052010123', email: 'a@x.co' }, respond({}, 500), NOW)).toEqual({ kind: 'unknown' });
  });
  it('Do Not Sell on the lead email, or on another email that uses the same phone', async () => {
    const mk = (leadsRows: unknown[], reqRows: unknown[]) => vi.fn(async (u: unknown) => new Response(JSON.stringify(String(u).includes('data_requests') ? reqRows : leadsRows), { status: 200 })) as unknown as typeof fetch;
    const who = { phone: '+13052010123', email: 'ana@example.com' };
    expect(await checkSuppressed(ENV, who, mk([], [{ email: 'ana@example.com', request: 'do_not_sell', status: 'new' }]))).toBe(true);
    expect(await checkSuppressed(ENV, who, mk([{ email: 'old@x.co' }], [{ email: 'old@x.co', request: 'delete', status: 'done' }]))).toBe(true);
    expect(await checkSuppressed(ENV, who, mk([], []))).toBe(false);
    expect(await checkSuppressed(ENV, who, respond({}, 500))).toBeNull();
  });
});

describe('owner message', () => {
  it('is a summary: no name, email, phone or address', () => {
    const m = newLeadMessage({ id: 'i', status: 'sent', reason: null, state: 'FL', source: 'results', timeline: 'asap', bill_bucket: '200_300', phone_verified: false, buyers: ['Acme'] });
    const all = [m.subject, ...m.lines].join('\n');
    expect(all).toContain('Acme');
    expect(all).not.toMatch(/@|\+1|Palm|Ana/);
  });
});

describe('rate limit', () => {
  it('hashes the IP, allows when under, blocks when the RPC says false, fails open on errors', async () => {
    expect(rateLimitKey('leads', '1.2.3.4')).toMatch(/^leads:[0-9a-f]{40}$/);
    expect(rateLimitKey('leads', '1.2.3.4')).not.toContain('1.2.3.4');
    const rpc = (v: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(v), { status })) as unknown as typeof fetch;
    expect(await allowRequest(ENV, 'leads', '1.2.3.4', 600, 8, rpc(true))).toBe(true);
    expect(await allowRequest(ENV, 'leads', '1.2.3.4', 600, 8, rpc(false))).toBe(false);
    expect(await allowRequest(ENV, 'leads', '1.2.3.4', 600, 8, rpc({}, 500))).toBe(true);
    expect(await allowRequest(ENV, 'leads', null, 600, 8, rpc(false))).toBe(true);
    const boom = vi.fn(async () => { throw new Error('x'); }) as unknown as typeof fetch;
    expect(await allowRequest(ENV, 'leads', '1.2.3.4', 600, 8, boom)).toBe(true);
  });
});

describe('runInBackground', () => {
  it('awaits the work when there is no platform waitUntil, and swallows errors', async () => {
    let done = false;
    await runInBackground(async () => { done = true; });
    expect(done).toBe(true);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(runInBackground(async () => { throw new Error('x'); })).resolves.toBeUndefined();
    spy.mockRestore();
  });
  it('uses waitUntil when the platform provides it', async () => {
    const waitUntil = vi.fn();
    (globalThis as Record<symbol, unknown>)[Symbol.for('@vercel/request-context')] = { get: () => ({ waitUntil }) };
    await runInBackground(async () => 1);
    delete (globalThis as Record<symbol, unknown>)[Symbol.for('@vercel/request-context')];
    expect(waitUntil).toHaveBeenCalledOnce();
  });
});
