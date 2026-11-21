import { describe, expect, it, vi } from 'vitest';
import { handleOut } from './affiliate-click';

const NOW = new Date('2026-11-22T12:00:00Z');
const offerRow = (o: Record<string, unknown> = {}) => ({
  id: 'id-1', slug: 'brand-a', brand: 'Brand A', program: null, network: null, country: 'US', category: 'battery',
  destination_url_template: 'https://merchant.example/?aff=XYZ&sub={slug}', cta_text: 'See it', headline: null, description: null,
  price_text: null, price_source_url: null, price_verified_on: null, disclosure_key: 'affiliate_standard', active: true, starts_at: null, ends_at: null, ...o,
});
const readEnv = { url: 'https://db.example.co', key: 'anon' };
const env = { SUPABASE_URL: 'https://db.example.co', SUPABASE_SECRET_KEY: 'secret' };

function fakeFetch(rows: unknown[], insertOk = true) {
  const inserts: unknown[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'POST') {
      inserts.push(JSON.parse(String(init.body)));
      return new Response(null, { status: insertOk ? 201 : 500 });
    }
    return new Response(JSON.stringify(rows), { status: 200 });
  });
  return { f: f as unknown as typeof fetch, inserts };
}
const req = (qs = '', headers: Record<string, string> = {}, method = 'GET') => new Request(`https://rayvalue.com/go/out/brand-a${qs}`, { method, headers });

describe('/go/out/<slug>', () => {
  it('logs one row and 302s to the merchant, with no cookie and no IP or UA string stored', async () => {
    const { f, inserts } = fakeFetch([offerRow()]);
    const res = await handleOut(req('?p=%2Fguides%2Fx', { 'user-agent': 'Mozilla/5.0 (iPhone) Mobile', 'x-vercel-ip-country': 'us', 'x-forwarded-for': '1.2.3.4' }), 'brand-a', env, f, NOW, readEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://merchant.example/?aff=XYZ&sub=brand-a');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(inserts).toEqual([[{ offer_id: 'id-1', page_path: '/guides/x', country: 'US', ua_class: 'mobile' }]]);
    expect(JSON.stringify(inserts)).not.toContain('1.2.3.4');
    expect(JSON.stringify(inserts)).not.toContain('Mozilla');
  });

  it('uses a same-origin Referer when there is no ?p=', async () => {
    const { f, inserts } = fakeFetch([offerRow()]);
    await handleOut(req('', { referer: 'https://rayvalue.com/blog/post?x=1' }), 'brand-a', env, f, NOW, readEnv);
    expect((inserts[0] as { page_path: string }[])[0]?.page_path).toBe('/blog/post');
    const other = fakeFetch([offerRow()]);
    await handleOut(req('', { referer: 'https://evil.example/blog/post' }), 'brand-a', env, other.f, NOW, readEnv);
    expect((other.inserts[0] as { page_path: unknown }[])[0]?.page_path).toBeNull();
  });

  it('still redirects when the log write fails', async () => {
    const { f } = fakeFetch([offerRow()], false);
    const res = await handleOut(req(), 'brand-a', env, f, NOW, readEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('merchant.example');
  });

  it('sends visitors home, without logging, when the offer is missing, off or expired', async () => {
    for (const rows of [[], [offerRow({ active: false })], [offerRow({ ends_at: '2026-01-01T00:00:00Z' })], [offerRow({ destination_url_template: null })]]) {
      const { f, inserts } = fakeFetch(rows);
      const res = await handleOut(req(), 'brand-a', env, f, NOW, readEnv);
      expect(res.headers.get('location')).toBe('/');
      expect(inserts).toEqual([]);
    }
  });

  it('404s on a malformed slug and does not log HEAD requests', async () => {
    const { f, inserts } = fakeFetch([offerRow()]);
    expect((await handleOut(req(), '../x', env, f, NOW, readEnv)).status).toBe(404);
    const head = await handleOut(req('', {}, 'HEAD'), 'brand-a', env, f, NOW, readEnv);
    expect(head.status).toBe(302);
    expect(inserts).toEqual([]);
  });
});
