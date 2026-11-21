import { describe, expect, it } from 'vitest';
import { parseFeed } from './feed';
import { languageCodes, scoreRelevance, toNewsRows } from './news';

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
<item><title><![CDATA[New <b>solar</b> subsidy announced]]></title><link>/news/1</link><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate><description>Rebate for &lt;p&gt;home batteries&lt;/p&gt;</description></item>
<item><title>Office closed on Friday</title><link>https://example.org/news/2</link></item>
<item><title>No link</title></item>
</channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Einspeisevergütung sinkt</title><link rel="alternate" href="https://example.de/a"/><link rel="self" href="https://example.de/self"/><updated>2026-11-01T08:00:00Z</updated><summary>Photovoltaik</summary></entry></feed>`;

describe('parseFeed', () => {
  it('parses RSS with CDATA, relative links and dates; drops linkless items', () => {
    const items = parseFeed(RSS, 'https://example.org/feed.xml');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: 'New solar subsidy announced', url: 'https://example.org/news/1', publishedAt: '2026-11-16T10:00:00.000Z', summary: 'Rebate for home batteries' });
  });
  it('parses Atom, preferring the alternate link', () => {
    expect(parseFeed(ATOM)[0]).toMatchObject({ url: 'https://example.de/a', publishedAt: '2026-11-01T08:00:00.000Z' });
  });
});

describe('news relevance', () => {
  it('parses language cells', () => {
    expect(languageCodes('fr/nl')).toEqual(['fr', 'nl']);
    expect(languageCodes('English/Sinhala/Tamil')).toEqual(['en', 'si', 'ta']);
    expect(languageCodes('nb')).toEqual(['no']);
  });
  it('scores English plus the pack language, with boundaries on short or embedded words', () => {
    expect(scoreRelevance('New solar subsidy for home batteries', 'en').topics.sort()).toEqual(['battery', 'solar', 'subsidy']);
    expect(scoreRelevance('Einspeisevergütung für Photovoltaik sinkt', 'de').topics.sort()).toEqual(['feed_in', 'solar']);
    expect(scoreRelevance('Einspeisevergütung', 'en').relevance).toBe(0);
    expect(scoreRelevance('Immigrant migrant program', 'en').relevance).toBe(0);
    expect(scoreRelevance('太陽光発電の補助金', 'ja').topics.sort()).toEqual(['solar', 'subsidy']);
  });
  it('keeps only relevant items', () => {
    const rows = toNewsRows(parseFeed(RSS, 'https://example.org/'), { id: 's1', country: 'xx', language: 'en' });
    expect(rows.map((r) => r.title)).toEqual(['New solar subsidy announced']);
    expect(rows[0]).toMatchObject({ source_id: 's1', country: 'xx' });
  });
});
