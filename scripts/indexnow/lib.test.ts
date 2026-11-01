import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { INDEXNOW_KEY, parseLocs, fingerprint, changedUrls, chunks, payload } from './lib';

describe('indexnow', () => {
  it('key file is served from public/ with the key as its only content', () => {
    expect(INDEXNOW_KEY).toMatch(/^[a-zA-Z0-9-]{8,128}$/);
    expect(readFileSync(`public/${INDEXNOW_KEY}.txt`, 'utf8')).toBe(INDEXNOW_KEY);
  });

  it('parseLocs reads sitemap and index <loc>s once each', () => {
    expect(parseLocs('<loc>https://rayvalue.com/a</loc><loc> https://rayvalue.com/b?x=1&amp;y=2 </loc><loc>https://rayvalue.com/a</loc>'))
      .toEqual(['https://rayvalue.com/a', 'https://rayvalue.com/b?x=1&y=2']);
  });

  it('fingerprint ignores scripts and attributes but sees visible text, title and robots changes', () => {
    const page = (body: string, nonce = 'n1', robots = 'index, follow') =>
      `<title>T</title><meta name="robots" content="${robots}"><main class="x" data-n="${nonce}"><script nonce="${nonce}">x()</script><p>${body}</p></main>`;
    expect(fingerprint(page('Rates $0.12'))).toBe(fingerprint(page('Rates $0.12', 'n2')));
    expect(fingerprint(page('Rates $0.12'))).not.toBe(fingerprint(page('Rates $0.13')));
    expect(fingerprint(page('a'))).not.toBe(fingerprint(page('a', 'n1', 'noindex')));
  });

  it('changedUrls: changed, new and removed pages; everything when there is no saved state', () => {
    const last = { checked_at: 't0', urls: { 'https://rayvalue.com/': 'a', 'https://rayvalue.com/x': 'b', 'https://rayvalue.com/gone': 'c' } };
    const now = { checked_at: 't1', urls: { 'https://rayvalue.com/': 'a', 'https://rayvalue.com/x': 'B', 'https://rayvalue.com/new': 'd' } };
    expect(changedUrls(last, now)).toEqual(['https://rayvalue.com/x', 'https://rayvalue.com/new', 'https://rayvalue.com/gone']);
    expect(changedUrls(null, now)).toEqual(Object.keys(now.urls));
  });

  it('payload and chunks follow the IndexNow format (max 10,000 URLs per call)', () => {
    expect(payload(['https://rayvalue.com/'])).toEqual({ host: 'rayvalue.com', key: INDEXNOW_KEY, keyLocation: `https://rayvalue.com/${INDEXNOW_KEY}.txt`, urlList: ['https://rayvalue.com/'] });
    expect(chunks(Array.from({ length: 10001 }, (_, i) => i)).map((c) => c.length)).toEqual([10000, 1]);
  });
});
