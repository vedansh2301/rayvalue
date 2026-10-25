import { describe, expect, it } from 'vitest';
import { displayDate, showUpdated } from './dates';

describe('dates', () => {
  it('formats as month day, year', () => {
    expect(displayDate(new Date('2026-10-25'))).toBe('Oct 25, 2026');
    expect(displayDate(new Date('2026-01-05'))).toBe('Jan 5, 2026');
  });
  it('shows Updated only when it differs from published', () => {
    expect(showUpdated(new Date('2026-10-25'), new Date('2026-10-25'))).toBe(false);
    expect(showUpdated(new Date('2026-10-22'), new Date('2026-10-25'))).toBe(true);
    expect(showUpdated(new Date('2026-10-22'), undefined)).toBe(false);
  });
});
