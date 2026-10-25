import { describe, it, expect } from 'vitest';
import { absoluteUrl, websiteJsonLd, organizationJsonLd, breadcrumbJsonLd, articleJsonLd, webApplicationJsonLd, calculatorsForState, safeJsonLd } from './jsonld';

describe('jsonld', () => {
  it('absoluteUrl has no trailing slash except root', () => {
    expect(absoluteUrl('/')).toBe('https://rayvalue.com/');
    expect(absoluteUrl('/guides/')).toBe('https://rayvalue.com/guides');
    expect(absoluteUrl('guides/x')).toBe('https://rayvalue.com/guides/x');
  });
  it('organization', () => {
    const o = organizationJsonLd();
    expect(o['@type']).toBe('Organization');
    expect(o.name).toBe('RayValue');
  });
  it('organization carries a contact point only when an email is configured', () => {
    expect('contactPoint' in organizationJsonLd()).toBe(false);
    expect(organizationJsonLd('https://rayvalue.com', 'hi@example.com').contactPoint).toMatchObject({ email: 'hi@example.com' });
  });
  it('website', () => {
    expect(websiteJsonLd()).toMatchObject({ '@type': 'WebSite', name: 'RayValue', url: 'https://rayvalue.com/' });
  });
  it('breadcrumb positions and optional last href', () => {
    const b = breadcrumbJsonLd([{ label: 'Home', href: '/' }, { label: 'Guides', href: '/guides' }, { label: 'X' }]);
    expect(b.itemListElement.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(b.itemListElement[1].item).toBe('https://rayvalue.com/guides');
    expect('item' in b.itemListElement[2]).toBe(false);
  });
  it('article', () => {
    const a = articleJsonLd({ headline: 'H', description: 'D', path: '/guides/h', updated: new Date('2026-10-01') });
    expect(a.dateModified).toBe('2026-10-01');
    expect(a.author['@type']).toBe('Organization');
    expect(a.mainEntityOfPage).toBe('https://rayvalue.com/guides/h');
  });
  it('blog posting carries datePublished', () => {
    const b = articleJsonLd({ headline: 'B', description: 'D', path: '/blog/b', published: new Date('2026-10-20'), updated: new Date('2026-10-22'), type: 'BlogPosting' });
    expect(b['@type']).toBe('BlogPosting');
    expect(b.datePublished).toBe('2026-10-20');
    expect(b.dateModified).toBe('2026-10-22');
  });
  it('web application is free finance app', () => {
    const w = webApplicationJsonLd('FL');
    expect(w.applicationCategory).toBe('FinanceApplication');
    expect(w.operatingSystem).toBe('Web');
    expect(w.areaServed.name).toBe('Florida');
    expect(w.offers.price).toBe(0);
    expect(w.isAccessibleForFree).toBe(true);
    expect(w.offers.price).toBe(0);
    expect(w.url).toBe('https://rayvalue.com/calculator/florida');
  });
  it('calculatorsForState', () => {
    expect(calculatorsForState('both').map((c) => c.state)).toEqual(['FL', 'CA']);
    expect(calculatorsForState('CA')).toHaveLength(1);
  });
  it('safeJsonLd prevents script breakout and round-trips', () => {
    const o = { a: '</script><script>alert(1)</script> & > \u2028' };
    const out = safeJsonLd(o);
    expect(out).not.toMatch(/[<>&\u2028]/);
    expect(JSON.parse(out)).toEqual(o);
  });
});
