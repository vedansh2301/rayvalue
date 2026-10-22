import { describe, expect, it } from 'vitest';
import { beforeSend, stripQuery } from './analytics';

describe('analytics beforeSend', () => {
  it('removes query strings and fragments', () => {
    expect(stripQuery('https://rayvalue.com/calculator/florida?zip=33101&utility=fpl&bill=200')).toBe('https://rayvalue.com/calculator/florida');
    expect(stripQuery('https://rayvalue.com/x#y')).toBe('https://rayvalue.com/x');
    expect(stripQuery('https://rayvalue.com/')).toBe('https://rayvalue.com/');
    expect(beforeSend({ type: 'pageview', url: 'https://rayvalue.com/a?zip=1' })).toEqual({ type: 'pageview', url: 'https://rayvalue.com/a' });
  });
});
