import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { footerSeoGroups, WORTH_GUIDES, type FooterGuide } from './footer-links';
import { DEFAULT_SOCIAL_PROFILES, parseSocialProfiles } from './social';
import { organizationJsonLd } from './seo/jsonld';
import type { IndexEntry } from './seo/site-index';

const place = (country: string, name: string, path: string): IndexEntry => ({ path, country, type: 'places', section: 'places', lastmod: null, title: name, summary: '', name, region: 'R', placeKind: 'place' });
const places: IndexEntry[] = [
  place('de', 'München', '/de/photovoltaik/bayern/muenchen'),
  place('de', 'Berlin', '/de/photovoltaik/berlin/berlin'),
  place('uk', 'Leeds', '/uk/solar-panels/yorkshire/leeds'),
  { ...place('uk', 'Yorkshire', '/uk/solar-panels/yorkshire'), placeKind: 'hub' },
];
const guides: FooterGuide[] = [
  { id: 'gb/are-solar-panels-worth-it-uk', country: 'gb', lang: 'en-GB', title: 'Are solar panels worth it in the UK?' },
  { id: 'gb/draft-one', country: 'gb', lang: 'en-GB', title: 'draft one', draft: true },
];
const input = { places, guides, usCities: [{ href: '/us/solar-payback/florida/miami', name: 'Miami', state: 'FL' }], usUtilities: [{ href: '/us/solar-payback/florida/fpl', label: 'FPL' }] };

describe('footerSeoGroups', () => {
  const g = footerSeoGroups({ ...input, perCountry: 1 });
  const links = g.flatMap((x) => x.links);

  it('lists the US first, then countries by name', () => {
    expect(g[0]!.segment).toBe('us');
    const rest = g.slice(1).map((x) => x.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
  });
  it('only links real paths, each once', () => {
    for (const l of links) expect(l.href.startsWith('/'), l.href).toBe(true);
    expect(new Set(links.map((l) => l.href)).size).toBe(links.length);
    for (const p of links.filter((l) => /^\/(uk|de)\/(solar-panels|photovoltaik)\//.test(l.href))) expect(places.map((x) => x.path)).toContain(p.href);
  });
  it('never links a hub as a place and caps places per country', () => {
    expect(links.some((l) => l.href === '/uk/solar-panels/yorkshire')).toBe(false);
    expect(g.find((x) => x.segment === 'de')!.links.filter((l) => l.href.startsWith('/de/photovoltaik/'))).toHaveLength(1);
  });
  it('uses the page language for place anchors', () => {
    const de = footerSeoGroups({ ...input, perCountry: 5 }).find((x) => x.segment === 'de')!;
    expect(de.links.every((l) => l.lang === 'de' || l.href.endsWith('rechner'))).toBe(true);
  });
  it('skips draft guides and has an editorial worth list', () => {
    expect(WORTH_GUIDES.length).toBeGreaterThan(0);
    expect(links.some((l) => l.label === 'draft one')).toBe(false);
  });
});

describe('social profiles', () => {
  it('Organization sameAs carries both profiles by default', () => {
    expect(organizationJsonLd().sameAs).toEqual(['https://www.instagram.com/rayvalue_usa/', 'https://www.facebook.com/1307379799134896']);
    expect(DEFAULT_SOCIAL_PROFILES).toHaveLength(2);
  });
  it('env override accepts https URLs only', () => {
    expect(parseSocialProfiles('https://a.example/x, http://bad, javascript:alert(1)')).toEqual(['https://a.example/x']);
    expect(parseSocialProfiles('')).toHaveLength(2);
  });
});

describe('markup', () => {
  it('has no inline style attributes (hashed CSP)', () => {
    for (const f of ['src/components/Footer.astro', 'src/components/Header.astro', 'src/components/home/CountryCard.astro', 'src/components/home/CountryTile.astro']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/\sstyle=/);
    }
  });
});
