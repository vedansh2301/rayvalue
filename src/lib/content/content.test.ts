import { describe, expect, it } from 'vitest';
import { FAQ, HOME_FAQ_IDS, QUOTES_FAQ_IDS, faqItems } from './faq';
import { FL_BATTERY_NOTES } from './fl-battery';
import { FINANCING_NOTES } from './financing';
import { faqJsonLd } from '../seo/jsonld';

describe('FAQ content', () => {
  it('has unique ids and every page list resolves', () => {
    expect(new Set(FAQ.map((f) => f.id)).size).toBe(FAQ.length);
    expect(faqItems(HOME_FAQ_IDS)).toHaveLength(FAQ.length);
    expect(faqItems(QUOTES_FAQ_IDS).length).toBeGreaterThan(0);
    expect(() => faqItems(['nope'])).toThrow();
  });

  it('covers the required questions', () => {
    const q = FAQ.map((f) => f.question).join('\n');
    for (const needle of ['really free', 'make money', 'Who will contact me', 'spam calls', 'federal tax credit', 'lease or PPA', 'accurate']) expect(q).toContain(needle);
  });

  it('never claims the federal credit is available, and promises no outcome', () => {
    const text = FAQ.map((f) => f.answer).join(' ').toLowerCase();
    expect(text).toContain('ended');
    expect(text).not.toMatch(/guarantee|will save|always pays|no spam|never call/);
  });

  it('makes no numeric claims beyond the 3-installer cap the consent wording and privacy page state', () => {
    const digits = FAQ.map((f) => f.answer).join(' ').match(/\d+/g) ?? [];
    expect(digits).toEqual(['3']);
  });

  it('JSON-LD mirrors exactly the visible items', () => {
    const items = faqItems(QUOTES_FAQ_IDS);
    const ld = faqJsonLd(items);
    expect(ld['@type']).toBe('FAQPage');
    expect(ld.mainEntity.map((e) => [e.name, e.acceptedAnswer.text])).toEqual(items.map((i) => [i.question, i.answer]));
  });
});

describe('Florida battery and financing notes', () => {
  const all = [...FL_BATTERY_NOTES, ...FINANCING_NOTES].map((n) => n.body).join(' ');
  it('contain no figures (no invented numbers)', () => {
    expect(all).not.toMatch(/\d/);
    expect(all).not.toMatch(/\$/);
  });
  it('explain that a battery adds cost but no bill savings in Florida, and what it does not power', () => {
    expect(all).toMatch(/adds cost but no extra bill savings/);
    expect(all).toMatch(/central air conditioning/);
  });
  it('does not use fear language', () => {
    expect(all.toLowerCase()).not.toMatch(/dangerous|deadly|devastat|disaster|panic|blackout/);
  });
});
