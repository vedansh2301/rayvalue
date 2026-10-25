import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { selectStories } from './stories';

const dir = new URL('../content/stories/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
const raw = files.map((f) => ({ f, text: readFileSync(new URL(f, dir), 'utf8') }));
const field = (text: string, re: RegExp) => re.exec(text)?.[1];

describe('stories content', () => {
  it('has 6 to 8 stories covering both states', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(files.length).toBeLessThanOrEqual(8);
    const states = raw.map((r) => field(r.text, /^state: (FL|CA)$/m));
    expect(states).toContain('FL');
    expect(states).toContain('CA');
  });

  it.each(raw)('$f has a source url, source date and report date', ({ text }) => {
    expect(field(text, /^ {2}url: "(https:\/\/[^"\s]+)"$/m)).toBeTruthy();
    expect(field(text, /^ {2}published: (\d{4}-\d{2}-\d{2})$/m)).toBeTruthy();
    expect(field(text, /^date_reported: (\d{4}-\d{2}-\d{2})$/m)).toBeTruthy();
    expect(field(text, /^ {2}publisher: "(.+)"$/m)).toBeTruthy();
  });

  it('never presents the federal credit as available', () => {
    for (const r of raw) expect(r.text.toLowerCase()).not.toMatch(/25d|federal tax credit/);
  });

  it('has unique source urls', () => {
    const urls = raw.map((r) => field(r.text, /^ {2}url: "([^"]+)"$/m));
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe('selectStories', () => {
  const mk = (state: 'FL' | 'CA', d: string) => ({ data: { state, date_reported: new Date(d) } });
  const all = [mk('FL', '2022-01-01'), mk('CA', '2024-01-01'), mk('FL', '2023-01-01')];
  it('filters by state and sorts newest first', () => {
    expect(selectStories(all, 'FL').map((s) => s.data.date_reported.getUTCFullYear())).toEqual([2023, 2022]);
    expect(selectStories(all, 'both')).toHaveLength(3);
  });
  it('applies limit', () => {
    expect(selectStories(all, 'both', 2)).toHaveLength(2);
    expect(selectStories(all, 'both', 0)).toHaveLength(0);
  });
});
