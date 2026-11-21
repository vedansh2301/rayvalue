import { describe, expect, it } from 'vitest';
import { AI_AND_SEARCH_AGENTS, ALLOW, DISALLOW, isAllowed, parseRobots, renderRobots } from './robots';

const txt = renderRobots();
const parsed = parseRobots(txt);

describe('renderRobots', () => {
  it('has one group per agent plus *, each repeating every Disallow and Allow', () => {
    expect(parsed.groups.map((g) => g.agents[0])).toEqual(['*', ...AI_AND_SEARCH_AGENTS]);
    for (const g of parsed.groups) {
      for (const d of DISALLOW) expect(g.rules.some((r) => !r.allow && r.path === d), `${g.agents[0]} ${d}`).toBe(true);
      for (const a of ALLOW) expect(g.rules.some((r) => r.allow && r.path === a), `${g.agents[0]} ${a}`).toBe(true);
    }
  });
  it('names the required AI crawlers', () => {
    for (const a of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'Bingbot', 'CCBot']) {
      expect(AI_AND_SEARCH_AGENTS).toContain(a);
    }
  });
  it('has exactly one Sitemap line, the index', () => {
    expect(parsed.sitemaps).toEqual(['https://rayvalue.com/sitemap.xml']);
  });
  it('disallows /api/ and /admin (no trailing slash) for everyone', () => {
    for (const a of ['*', 'GPTBot', 'ClaudeBot']) {
      expect(isAllowed(txt, a, '/admin')).toBe(false);
      expect(isAllowed(txt, a, '/admin/kpi')).toBe(false);
      expect(isAllowed(txt, a, '/api/leads')).toBe(false);
      expect(isAllowed(txt, a, '/go/out/some-partner')).toBe(false);
    }
  });
  it('allows pages, assets and llms files; blocks param and tracking URLs', () => {
    for (const a of ['*', 'GPTBot', 'OAI-SearchBot', 'Google-Extended']) {
      for (const p of ['/', '/us/solar-payback/florida/miami', '/_astro/x.js', '/og/default.png', '/llms.txt', '/llms-full.txt', '/us/llms.txt']) expect(isAllowed(txt, a, p), `${a} ${p}`).toBe(true);
      expect(isAllowed(txt, a, '/quotes?state=FL&source=x')).toBe(false);
      expect(isAllowed(txt, a, '/blog/x?utm_source=a')).toBe(false);
    }
  });
});
