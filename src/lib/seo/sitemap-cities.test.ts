import { describe, expect, it, vi } from 'vitest';
import { getPublishedCityUrls } from './sitemap-cities';

const base = { url: 'https://x.supabase.co', key: 'k' };
const json = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('getPublishedCityUrls', () => {
  it('returns absolute URLs and queries only published cities', async () => {
    const f = json([{ state: 'FL', slug: 'miami' }, { state: 'CA', slug: 'san-diego' }]);
    expect(await getPublishedCityUrls({ ...base, fetch: f as never })).toEqual([
      'https://rayvalue.com/solar/florida/miami',
      'https://rayvalue.com/solar/california/san-diego',
    ]);
    expect(String((f.mock.calls as unknown as [URL][])[0]![0])).toContain('published=is.true');
  });
  it('skips malformed rows', async () => {
    const f = json([{ state: 'TX', slug: 'a' }, { state: 'FL', slug: '../x' }, null, { state: 'FL', slug: 'ok' }]);
    expect(await getPublishedCityUrls({ ...base, fetch: f as never })).toEqual(['https://rayvalue.com/solar/florida/ok']);
  });
  it('returns [] on missing env, http error, bad body, or network failure', async () => {
    expect(await getPublishedCityUrls({ url: '', key: '' })).toEqual([]);
    expect(await getPublishedCityUrls({ ...base, fetch: json({}, 500) as never })).toEqual([]);
    expect(await getPublishedCityUrls({ ...base, fetch: json({ a: 1 }) as never })).toEqual([]);
    expect(await getPublishedCityUrls({ ...base, fetch: vi.fn(async () => { throw new Error('offline'); }) as never })).toEqual([]);
  });
});
