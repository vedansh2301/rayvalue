/**
 * robots.txt generator. A crawler obeys only the most specific matching User-agent group, so every named group repeats
 * the full Disallow list (a group with only "Allow: /" would silently drop the private-area and parameter rules).
 */
export const DISALLOW: readonly string[] = [
  // Private areas. `/admin` (no trailing slash) also matches the admin hub itself, which has trailingSlash 'never'.
  '/api/',
  '/admin',
  // Affiliate redirect hops (/go/out/<slug>): never crawled or indexed.
  '/go/out/',
  // Internal parameters on canonical pages (duplicate content)
  '/*?*source=',
  '/*?*state=',
  '/*?*zip=',
  '/*?*id=',
  '/*?*status=',
  // Tracking parameters
  '/*?*utm_',
  '/*?*gclid=',
  '/*?*fbclid=',
  '/*?*msclkid=',
  '/*?*ref=',
];

// Thank-you, form and paid-traffic pages (/go/) are NOT blocked: they carry a noindex tag, and a crawler can only
// see that tag on pages it may fetch.
export const ALLOW: readonly string[] = ['/', '/_astro/', '/og/', '/llms.txt', '/llms-full.txt', '/us/llms.txt'];

/** Search and answer engines plus AI crawlers, all allowed. Named groups so a policy change is a one-line edit. */
export const AI_AND_SEARCH_AGENTS: readonly string[] = [
  'Googlebot',
  'Bingbot',
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'PerplexityBot',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
];

export const SITEMAP_URL = 'https://rayvalue.com/sitemap.xml';

export function renderRobots(): string {
  const rules = [...ALLOW.map((p) => `Allow: ${p}`), ...DISALLOW.map((p) => `Disallow: ${p}`)];
  const group = (agent: string) => [`User-agent: ${agent}`, ...rules].join('\n');
  return ['*', ...AI_AND_SEARCH_AGENTS].map(group).join('\n\n') + `\n\nSitemap: ${SITEMAP_URL}\n`;
}

interface Group { agents: string[]; rules: { allow: boolean; path: string }[] }

export function parseRobots(txt: string): { groups: Group[]; sitemaps: string[] } {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1]!.toLowerCase();
    const v = m[2]!.trim();
    if (k === 'sitemap') { sitemaps.push(v); continue; }
    if (k === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v);
      lastWasAgent = true;
    } else if (cur && (k === 'allow' || k === 'disallow')) {
      lastWasAgent = false;
      if (v) cur.rules.push({ allow: k === 'allow', path: v });
    }
  }
  return { groups, sitemaps };
}

/** Robots pattern -> regex: "*" is a wildcard, everything else (including "?") is literal. */
const toRe = (pattern: string): RegExp => new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*'));

/** Google's rule: the longest matching pattern wins; Allow wins a tie. `pathAndQuery` includes the query string. */
export function isAllowed(txt: string, agent: string, pathAndQuery: string): boolean {
  const { groups } = parseRobots(txt);
  const g = groups.find((x) => x.agents.some((a) => a.toLowerCase() === agent.toLowerCase())) ?? groups.find((x) => x.agents.includes('*'));
  if (!g) return true;
  let best: { allow: boolean; len: number } | null = null;
  for (const r of g.rules) {
    if (!toRe(r.path).test(pathAndQuery)) continue;
    if (!best || r.path.length > best.len || (r.path.length === best.len && r.allow)) best = { allow: r.allow, len: r.path.length };
  }
  return best ? best.allow : true;
}
