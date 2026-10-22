import { describe, expect, it } from 'vitest';
import { parseContactEmail } from './contact';

describe('parseContactEmail', () => {
  it('accepts a plausible address (trimmed)', () => {
    expect(parseContactEmail(' hello@example.com ')).toBe('hello@example.com');
  });
  it('treats unset, blank and malformed values as no address', () => {
    for (const v of [undefined, null, '', '   ', 'not-an-email', 'a@b', 'x y@example.com', '<a@example.com>', 42]) {
      expect(parseContactEmail(v), String(v)).toBeNull();
    }
  });
});
