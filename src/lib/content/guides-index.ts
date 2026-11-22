/**
 * Pure data shaping for the guides indexes (/guides and /<cc>/guides): the topic of each guide and the interleaving of
 * countries within a topic. No numbers are typed here (CLAUDE.md rule 1); counts and dates come from the collection.
 *
 * TOPIC RULES (first match wins; haystack = slug + title, lowercased; keywords are structural, in the languages we cover):
 *   scams (scam / red-flag ...) -> battery -> worth ("is it worth it") -> money (grants, tax, VAT, rebates)
 *   -> export (export payments, feed-in, net metering ...) -> costs (cost, price, sizing) -> how (everything else).
 */
export const GUIDE_TOPICS = ['worth', 'money', 'export', 'battery', 'costs', 'scams', 'how'] as const;
export type GuideTopic = (typeof GUIDE_TOPICS)[number];
export const GUIDE_TOPIC_LABEL: Readonly<Record<GuideTopic, string>> = {
  worth: 'Is it worth it?', money: 'Grants, tax & VAT', export: 'Export payments', battery: 'Batteries', costs: 'Costs & sizing', scams: 'Scams & red flags', how: 'How it works',
};

const RULES: readonly [GuideTopic, RegExp][] = [
  ['scams', /scam|red-flag|arnaque|trouble|homon/],
  ['battery', /batter|speicher|thuisbatterij|chikuden|bateria|baterias|baterii|batteri|magazyn|generator|powerwall/],
  ['worth', /worth|rendabel|rentable|lohnt|conviene|vale-la-pena|vale-a-pena|merita|vyplati|oplaca|lonar|lonner|motogatoreru|doesnt-pay|earns/],
  ['money', /grant|subsid|rebate|tax|vat|iva|btw|tva|loan|kfw|foerderung|dotac|deduc|detrazione|bonus|aides|prime|enova|zuschuss|verguetung-pronovo|einmal|hojokin|kotitalous|credito|beneficios|ibi|warm-homes|energy-scotland|casa-solar|avdrag|greener|subvention|surya|exclusion|ley-1715|program-baterii/],
  ['export', /export|seg|feed-in|net-metering|net-billing|einspeise|saldering|teruglever|surplus|excedent|fio-b|compens|fit|baiden|ruecklief|prosum|plusskunde|ylijaama|salg|oemag|scambio|true-up|pretoky|sseg|generacion|homeflex|sharer|nem|tarif|tariff|capaciteit|dynamisch|spitzen|14a|strompreise|negatieve|base-services|certificats/],
  ['costs', /cost|kosten|price|prijs|units|how-many|size|east-west|winter|kwp|cost-by/],
];

export function guideTopic(a: { slug: string; title: string }): GuideTopic {
  const hay = `${a.slug} ${a.title}`.toLowerCase();
  for (const [t, re] of RULES) if (re.test(hay)) return t;
  return 'how';
}

/** Interleave items country by country (first of each country, then the second of each ...), keeping each country's own order. */
export function roundRobin<T>(items: readonly T[], key: (t: T) => string): T[] {
  const by = new Map<string, T[]>();
  for (const i of items) { const k = key(i); (by.get(k) ?? by.set(k, []).get(k)!).push(i); }
  const lists = [...by.values()];
  const out: T[] = [];
  for (let n = 0; out.length < items.length; n++) for (const l of lists) if (n < l.length) out.push(l[n]);
  return out;
}

/** Country cards: segments by guide count (desc), then name. */
export function guideCountries(items: readonly { segment: string }[], nameOf: (s: string) => string): { segment: string; name: string; n: number }[] {
  const c = new Map<string, number>();
  for (const i of items) c.set(i.segment, (c.get(i.segment) ?? 0) + 1);
  return [...c].map(([segment, n]) => ({ segment, name: nameOf(segment), n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}
