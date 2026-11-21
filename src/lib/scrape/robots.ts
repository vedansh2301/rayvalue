export const USER_AGENT = 'RayValueBot/1.0 (+https://rayvalue.com/about)';
const PRODUCT = 'rayvaluebot';

interface Rule {
  allow: boolean;
  pattern: string;
}
export interface Robots {
  rules: Rule[];
  crawlDelay: number | null;
}

export const ALLOW_ALL: Robots = { rules: [], crawlDelay: null };
export const DISALLOW_ALL: Robots = { rules: [{ allow: false, pattern: '/' }], crawlDelay: null };

/** Parse robots.txt for our product token (falls back to the `*` group). Longest match wins; allow beats disallow on ties. */
export function parseRobots(txt: string, agent = PRODUCT): Robots {
  type Group = { agents: string[]; rules: Rule[]; delay: number | null };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [], delay: null };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (field === 'allow' || field === 'disallow') {
      // An empty Disallow means "allow everything"; it adds no rule.
      if (value !== '') cur.rules.push({ allow: field === 'allow', pattern: value });
    } else if (field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) cur.delay = n;
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return { rules: chosen.flatMap((g) => g.rules), crawlDelay: chosen.find((g) => g.delay !== null)?.delay ?? null };
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp('^' + body.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path);
}

/** `pathAndQuery` e.g. "/a/b?x=1". */
export function isAllowed(robots: Robots, pathAndQuery: string): boolean {
  let best: Rule | null = null;
  for (const r of robots.rules) {
    if (!matches(r.pattern, pathAndQuery)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}
