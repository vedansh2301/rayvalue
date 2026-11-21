import { describe, expect, it } from 'vitest';
import { cadenceDays, canonicalUrl, contentHash, htmlToText, normaliseAccess, normaliseText } from './normalise';

describe('content hashing', () => {
  it('ignores markup, scripts and whitespace differences', () => {
    const a = '<html><head><script>var t=1</script></head><body><h1>Tariff</h1><p>7,70  ct/kWh</p></body></html>';
    const b = '<html><body>\n<h1>Tariff</h1>\n\n<p>7,70 ct/kWh</p><!-- build 123 --><script>var t=2</script></body></html>';
    expect(contentHash(htmlToText(a))).toBe(contentHash(htmlToText(b)));
  });
  it('changes when the visible number changes', () => {
    expect(contentHash(htmlToText('<p>7,70 ct/kWh</p>'))).not.toBe(contentHash(htmlToText('<p>7,20 ct/kWh</p>')));
  });
  it('decodes entities and normalises whitespace/unicode', () => {
    expect(normaliseText(htmlToText('<p>Caf&#233; &amp; &#8364;5</p>'))).toBe('Café & €5');
    expect(normaliseText('  a​\n\n b ')).toBe('a b');
  });
});

describe('pack cell normalisation', () => {
  it('takes the first recognised access token', () => {
    expect(normaliseAccess('html|pdf')).toBe('html');
    expect(normaliseAccess('pdf; xlsx')).toBe('pdf');
    expect(normaliseAccess('direct (CSV cp932)')).toBe('csv');
    expect(normaliseAccess('api; csv')).toBe('json');
    expect(normaliseAccess('Wayback 20260206001910', 'https://x.org/a.pdf')).toBe('pdf');
    expect(normaliseAccess('public, no login', 'https://x.org/a')).toBe('html');
    expect(normaliseAccess('xml')).toBe('rss');
  });
  it('maps cadence', () => {
    expect(cadenceDays('annual', 'regulator', 'html')).toBe(30);
    expect(cadenceDays('daily', 'regulator', 'html')).toBe(1);
    expect(cadenceDays('annual', 'rss', 'rss')).toBe(1);
    expect(cadenceDays('static', 'dataset', 'csv')).toBe(90);
    expect(cadenceDays('', 'other', 'html')).toBe(30);
  });
  it('canonicalises urls', () => {
    expect(canonicalUrl('https://Example.org/a/#x')).toBe('https://example.org/a');
    expect(canonicalUrl('https://example.org/')).toBe('https://example.org/');
  });
});
