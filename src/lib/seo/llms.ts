/**
 * /llms.txt, /us/llms.txt and /llms-full.txt (llmstxt.org format) rendered from the same IndexEntry list as the sitemaps,
 * so a URL can be in one only if it is in the other. Counts are computed from the entries (database rows); no number is
 * typed by hand. Pure.
 */
import { SITE_ORIGIN, absoluteUrl, type Country, type IndexEntry } from './site-index.ts';

const US_NAME = { name: 'United States', blurb: 'Florida and California homeowners' };
/** Display name of a non-US country segment ('uk' is GB), via the runtime's region names; no hand-typed list. */
const regionName = (cc: string): string => {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of((cc === 'uk' ? 'gb' : cc).toUpperCase()) ?? cc.toUpperCase(); } catch { return cc.toUpperCase(); }
};
const COUNTRY_NAMES = (cc: string): { name: string; blurb: string } => (cc === 'us' ? US_NAME : { name: regionName(cc), blurb: 'guides and blog posts' });
/** Countries (URL segments) that have a /<cc>/llms.txt: the US plus any country with article entries. */
export const llmsCountries = (entries: readonly IndexEntry[]): string[] => [...new Set(entries.map((e) => e.country))].filter((c) => c !== 'global').sort();

const STATE_NAMES = { FL: 'Florida', CA: 'California' } as const;

export const LLMS_PATHS = ['/llms.txt', '/llms-full.txt', '/us/llms.txt'] as const;
const isLlmsPath = (p: string): boolean => (LLMS_PATHS as readonly string[]).includes(p) || /^\/[a-z]{2}\/llms\.txt$/.test(p);

const link = (e: IndexEntry, origin: string): string => `- [${e.title}](${absoluteUrl(e.path, origin)}): ${e.summary}`;
const bySection = (entries: readonly IndexEntry[], section: IndexEntry['section']) => entries.filter((e) => e.section === section);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const INTRO = [
  '> RayValue publishes independent solar and home-battery payback calculators for homeowners in Florida and California.',
  '> Results are low / likely / high ranges, not single numbers. The federal residential solar credit (25D) is $0 for 2026+ installs and is never applied.',
  `> Every rate, cost and assumption is listed with its source and check date on ${SITE_ORIGIN}/methodology.`,
];

/** /llms.txt: what RayValue is, how the numbers are made, the countries (each linking to its own llms.txt), global guides. */
export function renderRootLlms(entries: readonly IndexEntry[], origin = SITE_ORIGIN): string {
  const countries = llmsCountries(entries);
  const lines = ['# RayValue', ...INTRO, '', '## How the numbers are made'];
  lines.push(`- [Methodology](${origin}/methodology): how system size, installed cost, bill savings and payback are estimated, and where every input comes from.`);
  lines.push('- Rates, costs and assumptions are read from a database; each fact stores its source URL and verification date, and each assumption stores its rationale.');
  lines.push('', '## Countries');
  for (const cc of countries) {
    const mine = entries.filter((e) => e.country === cc);
    const cities = mine.filter((e) => e.type === 'cities').length;
    const utilities = mine.filter((e) => e.type === 'utilities').length;
    const articles = mine.filter((e) => e.path.split('/').length === 4 && (e.section === 'guides' || e.section === 'blog')).length;
    const places = mine.filter((e) => e.type === 'places' && e.placeKind === 'place').length;
    const detail = cc === 'us' ? `${plural(cities, 'city page')}, ${plural(utilities, 'utility page')}` : places > 0 ? `${plural(articles, 'article')}, ${plural(places, 'place page')}` : plural(articles, 'article');
    lines.push(`- [${COUNTRY_NAMES(cc).name}](${origin}/${cc}/llms.txt): ${COUNTRY_NAMES(cc).blurb}; ${detail}.`);
  }
  for (const [heading, section] of [['Guides', 'guides'], ['Blog', 'blog'], ['About this site', 'about']] as const) {
    const list = bySection(entries.filter((e) => e.country === 'global'), section);
    if (list.length) lines.push('', `## ${heading}`, ...list.map((e) => link(e, origin)));
  }
  lines.push('', '## More', `- [Full text of every indexed page](${origin}/llms-full.txt)`);
  return lines.join('\n') + '\n';
}

/** /<cc>/llms.txt for a non-US country: its place pages (published, gated), guides and blog posts (indexable entries only). */
function renderArticleCountryLlms(mine: readonly IndexEntry[], cc: string, origin: string): string {
  const lines = [`# RayValue: ${COUNTRY_NAMES(cc).name}`, '> Independent solar and home-battery articles for readers in this country. Sources are listed on each article.'];
  const places = mine.filter((e) => e.type === 'places');
  const home = bySection(mine, 'home');
  if (home.length) lines.push('', '## Country home', ...home.map((e) => link(e, origin)));
  if (places.length) {
    const regions = [...new Set(places.map((e) => e.region ?? ''))].sort();
    const count = places.filter((e) => e.placeKind === 'place').length;
    lines.push('', `Coverage (computed from the database): ${plural(count, 'place page')} in ${plural(regions.length, 'region')}; each figure on a place page names its source and check date.`);
    for (const region of regions) {
      const list = places.filter((e) => (e.region ?? '') === region).sort((a, b) => (a.placeKind === b.placeKind ? a.path.localeCompare(b.path) : a.placeKind === 'hub' ? -1 : 1));
      lines.push('', `## Places: ${region}`, ...list.map((e) => link(e, origin)));
    }
  }
  for (const [heading, section] of [['Guides', 'guides'], ['Blog', 'blog']] as const) {
    const list = bySection(mine, section).sort((a, b) => a.path.localeCompare(b.path));
    if (list.length) lines.push('', `## ${heading}`, ...list.map((e) => link(e, origin)));
  }
  return lines.join('\n') + '\n';
}

/** /<cc>/llms.txt: calculators, utilities (with the sources of their rates), guides and every published city. */
export function renderCountryLlms(entries: readonly IndexEntry[], cc: Country, origin = SITE_ORIGIN): string {
  const mine = entries.filter((e) => e.country === cc);
  if (cc !== 'us') return renderArticleCountryLlms(mine, cc, origin);
  const cities = mine.filter((e) => e.type === 'cities');
  const utilities = mine.filter((e) => e.type === 'utilities');
  const states = [...new Set(mine.map((e) => e.state).filter((s): s is 'FL' | 'CA' => !!s))].sort();
  const newest = mine.map((e) => e.lastmod).filter((d): d is string => !!d).sort().at(-1);
  const lines = [
    `# RayValue: ${COUNTRY_NAMES(cc).name}`,
    '> Solar and battery payback for Florida and California homeowners, as low / likely / high ranges. The federal 25D credit is $0 for 2026+ installs and is never applied.',
    '',
    `Coverage (computed from the database): ${plural(states.length, 'state')}, ${plural(utilities.length, 'utility page')}, ${plural(cities.length, 'city page')}${newest ? `; newest data check ${newest}` : ''}.`,
  ];
  const calcs = bySection(mine, 'calculators');
  if (calcs.length) lines.push('', '## Calculators', ...calcs.map((e) => link(e, origin)));
  if (utilities.length) {
    lines.push('', '## Utilities (rate sources)');
    for (const u of utilities) {
      const src = (u.sources ?? []).map((s) => `${s.url}${s.checkedOn ? ` (checked ${s.checkedOn})` : ''}`).join('; ');
      lines.push(`${link(u, origin)}${src ? ` Rate sources: ${src}.` : ''}`);
    }
  }
  const tax = bySection(mine, 'tax');
  if (tax.length) lines.push('', '## Incentives and tax', ...tax.map((e) => link(e, origin)));
  for (const st of states) {
    const list = cities.filter((c) => c.state === st);
    if (list.length) lines.push('', `## Cities: ${STATE_NAMES[st]} (${list.length})`, ...list.map((e) => link(e, origin)));
  }
  return lines.join('\n') + '\n';
}

/** /llms-full.txt: one block per indexed page with its URL, data-check date and summary (utilities add their sources). */
export function renderLlmsFull(entries: readonly IndexEntry[], origin = SITE_ORIGIN): string {
  const lines = ['# RayValue (full index)', ...INTRO, ''];
  for (const e of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    lines.push(`## ${e.title}`, `URL: ${absoluteUrl(e.path, origin)}`);
    if (e.lastmod) lines.push(`Data checked: ${e.lastmod}`);
    lines.push(e.summary);
    if (e.utility) lines.push(`Default utility: ${e.utility.name}`);
    for (const s of e.sources ?? []) lines.push(`Rate source: ${s.url}${s.checkedOn ? ` (checked ${s.checkedOn})` : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Every same-site page URL linked or listed in an llms file (llms files themselves excluded). */
export function llmsPageUrls(txt: string, origin = SITE_ORIGIN): string[] {
  const urls = new Set<string>();
  for (const m of txt.matchAll(/https:\/\/[^\s)]+/g)) {
    const u = m[0].replace(/[.,;]+$/, '');
    if (!u.startsWith(`${origin}/`) && u !== origin) continue;
    const path = u.slice(origin.length) || '/';
    if (isLlmsPath(path)) continue;
    urls.add(u);
  }
  return [...urls];
}
