import { describe, expect, it } from 'vitest';
import { beforeSend, keepUtmOnly, stripQuery } from './analytics';

describe('analytics beforeSend', () => {
  it('removes query strings and fragments', () => {
    expect(stripQuery('https://rayvalue.com/calculator/florida?zip=33101&utility=fpl&bill=200')).toBe('https://rayvalue.com/calculator/florida');
    expect(stripQuery('https://rayvalue.com/x#y')).toBe('https://rayvalue.com/x');
    expect(stripQuery('https://rayvalue.com/')).toBe('https://rayvalue.com/');
    expect(beforeSend({ type: 'pageview', url: 'https://rayvalue.com/a?zip=1' })).toEqual({ type: 'pageview', url: 'https://rayvalue.com/a' });
  });

  it('keeps UTM tags and drops the ZIP, bill and anything else', () => {
    expect(keepUtmOnly('https://rayvalue.com/calculator/florida?utm_source=meta&utm_medium=paid_social&utm_campaign=fl_reel&fbclid=abc'))
      .toBe('https://rayvalue.com/calculator/florida?utm_source=meta&utm_medium=paid_social&utm_campaign=fl_reel');
    expect(keepUtmOnly('https://rayvalue.com/calculator/florida?zip=33101&bill=200&utm_campaign=fl_reel#results'))
      .toBe('https://rayvalue.com/calculator/florida?utm_campaign=fl_reel');
    expect(keepUtmOnly('https://rayvalue.com/a?utm_campaign=fl_reel&utm_source=meta')).toBe('https://rayvalue.com/a?utm_source=meta&utm_campaign=fl_reel');
    expect(beforeSend({ type: 'pageview', url: 'https://rayvalue.com/?utm_source=instagram' })).toEqual({ type: 'pageview', url: 'https://rayvalue.com/?utm_source=instagram' });
  });

  it('drops UTM values that could carry personal data', () => {
    expect(keepUtmOnly('https://rayvalue.com/a?utm_source=ann%40example.com')).toBe('https://rayvalue.com/a');
    expect(keepUtmOnly('https://rayvalue.com/a?utm_term=33101')).toBe('https://rayvalue.com/a');
    expect(keepUtmOnly('https://rayvalue.com/a?utm_content=12%20Main%20St')).toBe('https://rayvalue.com/a');
    expect(keepUtmOnly(`https://rayvalue.com/a?utm_campaign=${'x'.repeat(61)}`)).toBe('https://rayvalue.com/a');
  });
});
