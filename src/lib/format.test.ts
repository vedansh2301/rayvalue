import { describe, expect, it } from 'vitest';
import { formatRange, formatUsd } from './format';

describe('formatUsd', () => {
  it('formats whole dollars with grouping', () => {
    expect(formatUsd(12500)).toBe('$12,500');
  });
  it('rounds away cents', () => {
    expect(formatUsd(99.6)).toBe('$100');
  });
});

describe('formatRange', () => {
  it('shows low – high with likely in parentheses', () => {
    expect(formatRange({ low: 10000, likely: 12000, high: 15000 }, formatUsd)).toBe(
      '$10,000 – $15,000 (likely $12,000)',
    );
  });
  it('defaults to plain number formatting', () => {
    expect(formatRange({ low: 6, likely: 7.5, high: 9 })).toBe('6 – 9 (likely 7.5)');
  });
});
