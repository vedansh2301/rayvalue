import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { PAGE_META, fullTitle } from './page-meta';
import { UTILITY_PAGES } from '../utility/pages';

/** Minimal frontmatter reader for the content files (flat `key: "value"` lines). */
function frontmatter(dir: string): { file: string; title: string; seoTitle?: string; description: string }[] {
  return readdirSync(dir).filter((f) => /\.mdx?$/.test(f)).map((file) => {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(`${dir}/${file}`, 'utf8'))![1];
    const get = (k: string) => {
      const m = new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(fm);
      return m ? m[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"') : undefined;
    };
    return { file, title: get('title')!, seoTitle: get('seoTitle'), description: get('description')! };
  });
}

describe('static page meta lengths', () => {
  for (const [key, m] of Object.entries(PAGE_META)) {
    it(`${key}: full title 50-60, description 140-160`, () => {
      const t = fullTitle(m.title, key === 'home');
      expect(t.length, t).toBeGreaterThanOrEqual(50);
      expect(t.length, t).toBeLessThanOrEqual(60);
      expect(m.description.length, m.description).toBeGreaterThanOrEqual(140);
      expect(m.description.length, m.description).toBeLessThanOrEqual(160);
    });
  }
  for (const u of UTILITY_PAGES) {
    it(`utility ${u.slug}: full title 50-60`, () => {
      expect(fullTitle(u.title).length).toBeGreaterThanOrEqual(50);
      expect(fullTitle(u.title).length).toBeLessThanOrEqual(60);
    });
  }
});

describe('content entry meta lengths', () => {
  for (const dir of ['blog', 'guides']) {
    for (const e of frontmatter(`./src/content/${dir}`)) {
      it(`${dir}/${e.file}: <title> at most 60, description 140-160`, () => {
        const t = fullTitle(e.seoTitle ?? e.title);
        expect(t.length, t).toBeLessThanOrEqual(60);
        expect(e.description.length, e.description).toBeGreaterThanOrEqual(140);
        expect(e.description.length, e.description).toBeLessThanOrEqual(160);
      });
    }
  }
});
