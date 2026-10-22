import { describe, expect, it } from 'vitest';
import { createRunGuard } from './run-guard';

describe('createRunGuard', () => {
  it('a new run supersedes and aborts the previous one', () => {
    const g = createRunGuard();
    const a = g.start();
    expect(a.isCurrent()).toBe(true);
    const b = g.start();
    expect(a.isCurrent()).toBe(false);
    expect(a.signal.aborted).toBe(true);
    expect(b.isCurrent()).toBe(true);
    expect(b.signal.aborted).toBe(false);
  });
  it('cancel invalidates the in-flight run', () => {
    const g = createRunGuard();
    const a = g.start();
    g.cancel();
    expect(a.isCurrent()).toBe(false);
    expect(a.signal.aborted).toBe(true);
    g.cancel(); // idempotent
    expect(g.start().isCurrent()).toBe(true);
  });
});
