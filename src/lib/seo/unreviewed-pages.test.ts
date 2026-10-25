import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UNREVIEWED_PAGES } from './unreviewed-pages';

const PAGES = join(process.cwd(), 'src/pages');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith('.astro') ? [join(dir, f)] : []));

describe('owner placeholders', () => {
  it('a static page that still contains a {{PLACEHOLDER}} must be in UNREVIEWED_PAGES (noindex)', () => {
    const offenders = files(PAGES)
      .filter((f) => /\{\{[A-Z][A-Z_]+\}\}/.test(readFileSync(f, 'utf8')))
      .map((f) => '/' + relative(PAGES, f).replace(/(\/index)?\.astro$/, '').replace(/^index$/, ''))
      .filter((p) => !UNREVIEWED_PAGES.has(p));
    expect(offenders).toEqual([]);
  });
});
