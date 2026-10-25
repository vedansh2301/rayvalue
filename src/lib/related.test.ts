import { describe, expect, it } from 'vitest';
import { pickRelated } from './related';

const p = (id: string, state: 'FL' | 'CA' | 'both' | undefined, tags: string[], day: number) => ({ id, state, tags, published: new Date(Date.UTC(2026, 9, day)) });
const all = [
  p('a', 'FL', ['rates'], 1),
  p('b', 'FL', ['rates', 'bills'], 2),
  p('c', 'CA', ['rates'], 3),
  p('d', 'CA', ['battery'], 4),
  p('e', 'both', [], 5),
];

describe('pickRelated', () => {
  it('excludes the current post and returns at most n', () => {
    const r = pickRelated(all[0], all);
    expect(r.length).toBe(3);
    expect(r.map((x) => x.id)).not.toContain('a');
  });
  it('ranks shared tags and state first', () => {
    expect(pickRelated(all[0], all).map((x) => x.id)).toEqual(['b', 'c', 'e']);
  });
  it('still fills with other posts when little matches', () => {
    expect(pickRelated(p('z', undefined, [], 9), all).length).toBe(3);
  });
});
