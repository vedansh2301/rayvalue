/**
 * CLAUDE.md rule 6: any page with affiliate links shows the disclosure above the first link.
 * Static guard over the source: the slot renders <Disclosure /> before any card, cards/links are only
 * used inside the slot, and every page that shows the slot is wired through it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd(), 'src');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(astro|mdx)$/.test(f)) out.push(full);
  }
  return out;
}

describe('affiliate disclosure order', () => {
  it('OfferSlot renders the disclosure before the first card', () => {
    const slot = read('components/OfferSlot.astro');
    const body = slot.split('---').slice(2).join('---');
    expect(body.indexOf('<Disclosure')).toBeGreaterThan(-1);
    expect(body.indexOf('<Disclosure')).toBeLessThan(body.indexOf('<OfferCard'));
  });

  it('OfferSlot renders nothing without offers (guarded on the first offer)', () => {
    const slot = read('components/OfferSlot.astro');
    expect(slot).toMatch(/\{first && \(/);
  });

  it('only OfferSlot uses OfferCard; OfferLink users must render a disclosure earlier in the same file', () => {
    for (const file of walk(root)) {
      const rel = file.slice(root.length + 1);
      if (rel === 'components/OfferSlot.astro' || rel === 'components/OfferCard.astro' || rel === 'components/OfferLink.astro') continue;
      const src = readFileSync(file, 'utf8');
      const body = src.startsWith('---') ? src.split('---').slice(2).join('---') : src;
      expect(body, `${rel} uses OfferCard outside OfferSlot`).not.toContain('<OfferCard');
      const link = body.indexOf('<OfferLink');
      if (link >= 0) {
        const disclosure = Math.min(...['<Disclosure', '<OfferSlot'].map((t) => (body.indexOf(t) >= 0 ? body.indexOf(t) : Infinity)));
        expect(disclosure, `${rel}: <OfferLink> without a disclosure above it`).toBeLessThan(link);
      }
    }
  });

  it('every page that renders an OfferSlot passes offers from the placement helper', () => {
    for (const p of ['components/calculator/CalculatorPage.astro', 'components/content/GuideArticle.astro', 'components/content/BlogArticle.astro']) {
      const src = read(p);
      expect(src).toContain('offersForPage(');
      expect(src).toContain('<OfferSlot offers={');
    }
  });

  it('offer links are sponsored and nofollow and go through the click redirect', () => {
    for (const p of ['components/OfferCard.astro', 'components/OfferLink.astro']) {
      const src = read(p);
      expect(src).toContain('rel="sponsored nofollow noopener"');
      expect(src).toContain('outHref(');
    }
  });
});
