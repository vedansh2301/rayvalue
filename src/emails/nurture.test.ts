import { describe, expect, it } from 'vitest';
import { NURTURE_EMAILS, quotesUrl, renderNurtureEmail } from './nurture';
import { NURTURE_OFFSETS_DAYS } from '../lib/nurture/schedule';

const ctx = (over = {}) => ({
  siteUrl: 'https://rayvalue.com',
  state: 'FL' as 'FL' | 'CA' | null,
  snapshot: { payback: { low: '9 years', likely: '12 years', high: '16 years' } } as never,
  unsubscribeUrl: 'https://rayvalue.com/unsubscribe?t=x',
  mailingAddress: null as string | null,
  ...over,
});

describe('nurture emails', () => {
  it('has 5 emails on the agreed days', () => {
    expect(NURTURE_EMAILS).toHaveLength(5);
    expect([1, 2, 3, 4, 5].map((s) => renderNurtureEmail(s, ctx())!.day)).toEqual([...NURTURE_OFFSETS_DAYS]);
    expect(renderNurtureEmail(6, ctx())).toBeNull();
  });
  for (const state of ['FL', 'CA', null] as const) {
    for (const step of [1, 2, 3, 4, 5]) {
      it(`email ${step} (${state ?? 'no state'}) has unsubscribe, mailing address placeholder, and no banned claims`, () => {
        const m = renderNurtureEmail(step, ctx({ state }))!;
        expect(m.subject.length).toBeGreaterThan(5);
        expect(m.text).toContain('https://rayvalue.com/unsubscribe?t=x');
        expect(m.text).toContain('{{MAILING_ADDRESS}}');
        // Federal 25D credit is never presented as available.
        expect(m.text.toLowerCase()).not.toMatch(/tax credit (is|are) available|claim the (federal )?(tax )?credit|30%/);
        // No invented figures: any digits must come from the estimate rows or be list numbering / dates in links.
        const prose = m.text.replace(/https?:\S+/g, '').replace(/^\d\. /gm, '').replace(/\bNEM 3\.0\b/g, '').replace(/\b(\d+) years\b/g, '').replace(/\(.*\)/g, '');
        expect(prose).not.toMatch(/\$\d|\d%|\b\d{2,}\b/);
      });
    }
  }
  it('substitutes the real mailing address', () => {
    const m = renderNurtureEmail(2, ctx({ mailingAddress: '1 Example St, Town' }))!;
    expect(m.text).toContain('RayValue, 1 Example St, Town');
    expect(m.text).not.toContain('{{');
  });
  it('email 1 shows the saved estimate and a link back to the calculator', () => {
    const m = renderNurtureEmail(1, ctx())!;
    expect(m.text).toContain('Payback: 12 years likely');
    expect(m.text).toContain('https://rayvalue.com/calculator/florida');
  });
  it('email 4 is state specific', () => {
    expect(renderNurtureEmail(4, ctx({ state: 'FL' }))!.text).toMatch(/outage/i);
    expect(renderNurtureEmail(4, ctx({ state: 'FL' }))!.text).not.toMatch(/NEM 3\.0/);
    expect(renderNurtureEmail(4, ctx({ state: 'CA' }))!.text).toMatch(/NEM 3\.0/);
  });
  it('email 5 links to quotes prefilled with state and tagged as nurture', () => {
    const u = quotesUrl(ctx({ state: 'CA' }), 'nurture_5');
    expect(u).toBe('https://rayvalue.com/quotes?state=CA&utm_source=nurture&utm_medium=email&utm_campaign=nurture_5');
    expect(renderNurtureEmail(5, ctx({ state: 'CA' }))!.text).toContain(u);
  });
});
