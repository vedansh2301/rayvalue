import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { homeStories, mixStories, olderStoryYear, selectStories, STORY_RECENT_FROM_YEAR } from './stories';

const dir = new URL('../content/stories/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
const raw = files.map((f) => ({ f, text: readFileSync(new URL(f, dir), 'utf8') }));
const field = (text: string, re: RegExp) => re.exec(text)?.[1];

describe('stories content', () => {
  it('has at least 6 stories covering both states', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
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

  it('has recent stories (reported 2024 or later) in both states', () => {
    for (const st of ['FL', 'CA']) {
      const recent = raw.filter((r) => field(r.text, /^state: (FL|CA)$/m) === st && Number(field(r.text, /^date_reported: (\d{4})/m)) >= STORY_RECENT_FROM_YEAR);
      expect(recent.length).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(raw)('$f: an image has alt text and a file on disk', ({ f, text }) => {
    const img = field(text, /^image: "([^"]+)"$/m);
    if (!img) return;
    expect(field(text, /^imageAlt: "(.+)"$/m)).toBeTruthy();
    expect(existsSync(new URL(img, new URL(f, dir)))).toBe(true);
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
  it('without a limit returns every story in the state, newest first', () => {
    expect(selectStories(all, 'both').map((s) => s.data.date_reported.getUTCFullYear())).toEqual([2024, 2023, 2022]);
  });
});

describe('mixStories (mostly recent, one older for context)', () => {
  const mk = (d: string, state: 'FL' | 'CA' = 'FL') => ({ data: { state, date_reported: new Date(d) } });
  const years = (xs: { data: { date_reported: Date } }[]) => xs.map((s) => s.data.date_reported.toISOString().slice(0, 7));
  const pool = [mk('2021-07-01'), mk('2025-08-01'), mk('2022-10-01'), mk('2026-06-01'), mk('2024-10-01'), mk('2025-11-01'), mk('2022-04-01')];

  it('takes the newest limit-1 recent stories plus the newest older one, newest first', () => {
    expect(years(mixStories(pool, 3))).toEqual(['2026-06', '2025-11', '2022-10']);
    expect(years(mixStories(pool, 4))).toEqual(['2026-06', '2025-11', '2025-08', '2022-10']);
  });
  it('includes at most one older story while recent ones remain', () => {
    const out = mixStories(pool, 5);
    expect(out.filter((s) => olderStoryYear(s.data.date_reported) !== null)).toHaveLength(1);
    expect(years(out)).toEqual(['2026-06', '2025-11', '2025-08', '2024-10', '2022-10']);
  });
  it('fills with older stories when there are not enough recent ones', () => {
    const few = [mk('2025-01-01'), mk('2022-01-01'), mk('2021-01-01'), mk('2019-01-01')];
    expect(years(mixStories(few, 3))).toEqual(['2025-01', '2022-01', '2021-01']);
  });
  it('fills with recent stories when there is no older one', () => {
    const recentOnly = [mk('2024-02-01'), mk('2026-01-01'), mk('2025-01-01'), mk('2024-06-01')];
    expect(years(mixStories(recentOnly, 3))).toEqual(['2026-01', '2025-01', '2024-06']);
  });
  it('limit 1 shows the newest recent story; limit 0 shows none; a small pool is returned whole', () => {
    expect(years(mixStories(pool, 1))).toEqual(['2026-06']);
    expect(mixStories(pool, 0)).toHaveLength(0);
    expect(years(mixStories([mk('2020-01-01'), mk('2024-01-01')], 3))).toEqual(['2024-01', '2020-01']);
  });
  it('is deterministic and does not mutate its input', () => {
    const copy = [...pool];
    expect(mixStories(pool, 3)).toEqual(mixStories(pool, 3));
    expect(pool).toEqual(copy);
  });
  it('selectStories with a limit uses the mix within the chosen state', () => {
    const both = [...pool, mk('2026-09-01', 'CA'), mk('2019-10-01', 'CA')];
    expect(selectStories(both, 'FL', 3).every((s) => s.data.state === 'FL')).toBe(true);
    expect(years(selectStories(both, 'CA', 3))).toEqual(['2026-09', '2019-10']);
  });
});

describe('home picks and year labels', () => {
  const mk = (state: 'FL' | 'CA', d: string) => ({ data: { state, date_reported: new Date(d) } });
  const all = [mk('CA', '2025-05-01'), mk('FL', '2019-01-01'), mk('FL', '2025-01-01'), mk('FL', '2023-06-01'), mk('CA', '2024-02-01')];
  it('mixes the newest recent Florida and California stories with one older story, newest first', () => {
    const out = homeStories(all);
    expect(out.map((s) => `${s.data.state}-${s.data.date_reported.getUTCFullYear()}`)).toEqual(['CA-2025', 'FL-2025', 'FL-2023']);
  });
  it('fills from recent stories when there is no older one, and from older ones when recent run out', () => {
    const recentOnly = [mk('CA', '2026-01-01'), mk('CA', '2025-01-01'), mk('FL', '2024-05-01')];
    expect(homeStories(recentOnly).map((s) => s.data.state)).toEqual(['CA', 'CA', 'FL']);
    const oldOnly = [mk('FL', '2021-01-01'), mk('CA', '2019-01-01'), mk('FL', '2022-01-01')];
    expect(homeStories(oldOnly).map((s) => s.data.date_reported.getUTCFullYear())).toEqual([2022, 2021, 2019]);
  });
  it('labels only pre-2024 stories with their year', () => {
    expect(olderStoryYear(new Date('2019-10-09'))).toBe(2019);
    expect(olderStoryYear(new Date('2023-12-31'))).toBe(2023);
    expect(olderStoryYear(new Date('2024-01-01'))).toBeNull();
  });
});
