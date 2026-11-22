import { describe, expect, it } from 'vitest';
import { blogTopic, countryChips, leadBadge, pickFeatured } from './blog-index';

const t = (id: string, title: string, tags: string[] = [], deadline?: Date) => blogTopic({ id, title, tags, deadline });

describe('blogTopic', () => {
  it('a dated deadline is Rules & deadlines', () => expect(t('gb/eco4', 'ECO4 ends', [], new Date('2026-12-31'))).toBe('policy'));
  it('detects "doesn\'t pay" across languages', () => {
    expect(t('when-solar-doesnt-pay-florida', "When solar doesn't pay in Florida")).toBe('nopay');
    expect(t('de/wann-photovoltaik-nicht-lohnt', 'Wann sich Photovoltaik nicht lohnt', ['angebot-pruefen'])).toBe('nopay');
    expect(t('ro/cand-nu-merita-panouri', 'x', ['oferte'])).toBe('nopay');
    expect(t('es/cuando-no-compensan-placas-solares', 'Cuándo no compensan')).toBe('nopay');
  });
  it('detects quote red flags', () => {
    expect(t('solar-quote-red-flags-2026', 'Red flags in a solar quote', ['quotes', 'scams'])).toBe('flags');
    expect(t('it/preventivi-fotovoltaico-segnali-allarme', 'Preventivi')).toBe('flags');
    expect(t('nl/misleidende-verkoop-zonnepanelen-thuisbatterij', 'Misleidende verkoop')).toBe('flags');
  });
  it('detects batteries, policy, costs, else worth it', () => {
    expect(t('de/stromspeicher-wann-rechnet-sich', 'Stromspeicher')).toBe('battery');
    expect(t('gb/energy-price-cap-january-2027-solar', 'Energy price cap')).toBe('policy');
    expect(t('residential-solar-prices-2026', 'What residential solar costs per watt', ['costs'])).toBe('costs');
    expect(t('es/merece-la-pena-placas-solares-2026', '¿Merecen la pena las placas solares?')).toBe('worth');
  });
});

const p = (id: string, segment: string, d: string, deadline?: string) => ({ id, segment, published: new Date(d), deadline: deadline ? new Date(deadline) : undefined });
describe('pickFeatured / leadBadge', () => {
  const now = new Date('2026-11-22');
  const posts = [p('a', 'us', '2026-11-01'), p('b', 'uk', '2026-11-10', '2026-12-31'), p('c', 'de', '2026-11-05'), p('d', 'us', '2026-10-01'), p('e', 'uk', '2026-10-20')];
  it('leads with the soonest upcoming deadline and spreads side cards across countries', () => {
    const f = pickFeatured(posts, now)!;
    expect(f.lead.id).toBe('b');
    expect(f.side.map((x) => x.id)).toEqual(['c', 'a']);
  });
  it('falls back to the newest post when no deadline is ahead', () => {
    expect(pickFeatured(posts, new Date('2027-02-01'))!.lead.id).toBe('b');
    expect(pickFeatured(posts.map((x) => ({ ...x, deadline: undefined })), now)!.lead.id).toBe('b');
  });
  it('features nothing for fewer than 4 posts', () => expect(pickFeatured(posts.slice(0, 3), now)).toBeNull());
  it('badge only for a real future deadline', () => {
    expect(leadBadge({ deadline: new Date('2026-12-31') }, now)).toBe('Deadline 31 December 2026');
    expect(leadBadge({ deadline: new Date('2026-01-01') }, now)).toBeNull();
    expect(leadBadge({}, now)).toBeNull();
  });
});

describe('countryChips', () => {
  it('sorts by count desc then name', () => {
    const c = countryChips([{ segment: 'de' }, { segment: 'uk' }, { segment: 'uk' }, { segment: 'at' }], (s) => s);
    expect(c.map((x) => `${x.segment}:${x.n}`)).toEqual(['uk:2', 'at:1', 'de:1']);
  });
});
