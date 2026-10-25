import { expect, it } from 'vitest';
import { stateTag } from './tags';

it('maps state codes to display tags', () => {
  expect(stateTag('FL')).toBe('Florida');
  expect(stateTag('CA')).toBe('California');
  expect(stateTag('both')).toBe('Florida and California');
  expect(stateTag(undefined)).toBe('Florida and California');
});
