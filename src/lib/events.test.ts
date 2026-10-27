import { describe, expect, it } from 'vitest';
import { EVENT_PROPS, isEventName, sanitizeEvent } from './events';

describe('sanitizeEvent', () => {
  it('knows the nine funnel events', () => {
    expect(Object.keys(EVENT_PROPS).sort()).toEqual(
      ['calc_complete', 'calc_start', 'calc_step', 'call_click', 'nav_click', 'phone_verified', 'quote_form_start', 'quote_submit', 'results_cta_click'].sort(),
    );
    expect(sanitizeEvent('nav_click', { placement: 'footer', target: '/calculator/florida' })).toEqual({ placement: 'footer', target: '/calculator/florida' });
    expect(isEventName('calc_start')).toBe(true);
    expect(isEventName('toString')).toBe(false);
    expect(sanitizeEvent('page_view')).toBeNull();
  });
  it('keeps allowlisted props and drops everything else', () => {
    expect(sanitizeEvent('calc_complete', { state: 'FL', battery: 1, shading: 'some', zip: '33101', email: 'a@b.co' })).toEqual({ state: 'FL', battery: 1, shading: 'some' });
    expect(sanitizeEvent('quote_submit', { source: 'city:florida/miami', state: 'FL', first_name: 'Ann' })).toEqual({ source: 'city:florida/miami', state: 'FL' });
  });
  it('rejects values that look like personal data', () => {
    expect(sanitizeEvent('quote_submit', { source: 'ann@example.com', state: 'FL' })).toEqual({ state: 'FL' });
    expect(sanitizeEvent('quote_submit', { source: '5551234567', state: 'FL' })).toEqual({ state: 'FL' });
    expect(sanitizeEvent('quote_submit', { source: '12 Main Street', state: 'FL' })).toEqual({ state: 'FL' });
    expect(sanitizeEvent('quote_submit', { source: 'x'.repeat(41) })).toEqual({});
    expect(sanitizeEvent('calc_step', { step: { n: 2 } as unknown })).toEqual({});
  });
});
