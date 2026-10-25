import { describe, expect, it } from 'vitest';
import { dueStep, NURTURE_OFFSETS_DAYS } from './schedule';

const day = 86_400_000;
const t0 = Date.parse('2026-11-02T12:00:00Z');
const row = (over: Partial<Parameters<typeof dueStep>[0]> = {}) => ({ created_at: new Date(t0).toISOString(), nurture_step: 0, nurture_last_sent_at: null, ...over });
const at = (days: number) => new Date(t0 + days * day);

describe('nurture schedule', () => {
  it('is 5 emails on days 0, 2, 5, 10, 18', () => {
    expect([...NURTURE_OFFSETS_DAYS]).toEqual([0, 2, 5, 10, 18]);
  });
  it('sends step 1 immediately when the estimate email has not gone out', () => {
    expect(dueStep(row(), at(0))).toBe(1);
  });
  it('treats a sent estimate email as step 1', () => {
    expect(dueStep(row({ email_status: 'sent' }), at(1))).toBeNull();
    expect(dueStep(row({ email_status: 'sent' }), at(2))).toBe(2);
  });
  it('waits for each offset', () => {
    expect(dueStep(row({ nurture_step: 2 }), at(4.9))).toBeNull();
    expect(dueStep(row({ nurture_step: 2 }), at(5))).toBe(3);
    expect(dueStep(row({ nurture_step: 3 }), at(9))).toBeNull();
    expect(dueStep(row({ nurture_step: 3 }), at(10))).toBe(4);
    expect(dueStep(row({ nurture_step: 4 }), at(18))).toBe(5);
  });
  it('never sends two in one run when catching up, and spaces them', () => {
    expect(dueStep(row({ nurture_step: 1 }), at(30))).toBe(2);
    expect(dueStep(row({ nurture_step: 1, nurture_last_sent_at: at(29.9).toISOString() }), at(30))).toBeNull();
  });
  it('stops after 5 and ignores stale or invalid sign-ups', () => {
    expect(dueStep(row({ nurture_step: 5 }), at(30))).toBeNull();
    expect(dueStep(row({ nurture_step: 1 }), at(40))).toBeNull();
    expect(dueStep(row({ created_at: 'nope' }), at(1))).toBeNull();
  });
});
