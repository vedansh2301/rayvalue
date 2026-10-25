import { describe, expect, it } from 'vitest';
import { coverTopic, readMinutes, stateKey, wordCount } from './cards';

describe('wordCount / readMinutes', () => {
  it('ignores imports, tags, code and link targets', () => {
    const mdx = 'import X from "./x";\n\n<Callout kind="a">Hello world</Callout>\n\n```js\nconst a = 1;\n```\n\n[two words](https://example.com/a-long-url)';
    expect(wordCount(mdx)).toBe(4);
  });
  it('rounds to whole minutes with a floor of 1', () => {
    expect(readMinutes('')).toBe(1);
    expect(readMinutes(undefined)).toBe(1);
    expect(readMinutes('word '.repeat(200))).toBe(1);
    expect(readMinutes('word '.repeat(1000))).toBe(5);
    expect(readMinutes('word '.repeat(1100))).toBe(6);
  });
});

describe('coverTopic', () => {
  it('uses the explicit topic first', () => {
    expect(coverTopic({ topic: 'sun', tags: ['battery'], title: 'x' })).toBe('sun');
  });
  it('derives from tags, then title', () => {
    expect(coverTopic({ tags: ['home-battery'], title: 'x' })).toBe('battery');
    expect(coverTopic({ tags: [], title: 'Florida electricity rates in 2026' })).toBe('bill');
  });
  it('falls back to a map for a single state and the sun otherwise', () => {
    expect(coverTopic({ title: 'zzz', state: 'CA' })).toBe('map');
    expect(coverTopic({ title: 'zzz', state: 'both' })).toBe('sun');
    expect(coverTopic({ title: 'zzz' })).toBe('sun');
  });
});

it('stateKey defaults to both', () => {
  expect(stateKey(undefined)).toBe('both');
  expect(stateKey('FL')).toBe('FL');
});
