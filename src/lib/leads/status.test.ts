import { describe, expect, it } from 'vitest';
import { leadStatus } from './status';

describe('leadStatus', () => {
  it('unserviced beats everything', () => {
    expect(leadStatus({ serviced: false, timeline: 'asap' })).toBe('unserviced');
    expect(leadStatus({ serviced: false, timeline: 'researching' })).toBe('unserviced');
  });
  it('serviced + just researching -> nurture', () => {
    expect(leadStatus({ serviced: true, timeline: 'researching' })).toBe('nurture');
  });
  it('serviced + ready -> new', () => {
    for (const t of ['asap', '1_3_months', '3_6_months'] as const) expect(leadStatus({ serviced: true, timeline: t })).toBe('new');
  });
});
