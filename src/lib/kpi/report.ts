/**
 * KPI report (pure). Turns lead / delivery / buyer rows and the owner-entered weekly inputs into per-week,
 * per-source and per-buyer numbers. Nothing is estimated: a figure that is not in the database and was not
 * entered by the owner is null and the page says where to find it (Vercel Analytics dashboard).
 *
 * Funnel: calculator starts -> completions -> quote form starts -> submissions -> verified -> delivered -> returned.
 * Database-side: submissions, verified, delivered, returned, revenue. Owner-entered (kpi_weekly_inputs, from the
 * Vercel Analytics dashboard): calculator starts, completions, results CTA clicks, quote form starts, ad spend.
 */
export const TARGETS = {
  /** Calculator completions as a share of starts: want above this. */
  completionRate: 0.5,
  /** Results-page "get quotes" clicks as a share of completions: want at least this. */
  resultsToQuoteRate: 0.1,
  /** Returned leads as a share of delivered leads: want below this. */
  returnRate: 0.1,
} as const;

export interface KpiLead {
  id: string;
  created_at: string;
  status: string;
  phone_verified: boolean;
  source: string;
  utm_source: string | null;
}
export interface KpiDelivery {
  lead_id: string;
  buyer_id: string;
  status: string;
  price: number | null;
}
export interface KpiBuyer {
  id: string;
  name: string;
  price: number | null;
}
export interface KpiInput {
  week_start: string;
  source: string;
  ad_spend: number | null;
  calc_starts: number | null;
  calc_completes: number | null;
  results_cta_clicks: number | null;
  quote_form_starts: number | null;
}

export interface Money {
  /** Sum of the prices that are known. */
  known: number;
  /** Deliveries counted in `known`'s base that have no price (not agreed, never guessed). */
  unpriced: number;
}

export interface Row {
  key: string;
  submissions: number;
  verified: number;
  delivered: number;
  returned: number;
  revenue: Money;
  /** Owner-entered; null while no row was entered (sums only entered values). */
  adSpend: number | null;
  calcStarts: number | null;
  calcCompletes: number | null;
  resultsCtaClicks: number | null;
  quoteFormStarts: number | null;
}

export interface BuyerRow {
  id: string;
  name: string;
  delivered: number;
  returned: number;
  revenue: Money;
}

export interface Report {
  weeks: Row[];
  sources: Row[];
  total: Row;
  buyers: BuyerRow[];
}

/** Monday (UTC) of the week containing `iso`, as YYYY-MM-DD. */
export function weekStart(iso: string): string {
  const d = new Date(iso);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow));
  return m.toISOString().slice(0, 10);
}

/** The label a lead is reported under: utm_source if it has one, else the form's source (results, quotes_page...). */
export const sourceKey = (l: Pick<KpiLead, 'source' | 'utm_source'>): string => (l.utm_source?.trim() ? l.utm_source.trim().toLowerCase() : l.source || 'unknown');

const emptyRow = (key: string): Row => ({
  key, submissions: 0, verified: 0, delivered: 0, returned: 0, revenue: { known: 0, unpriced: 0 },
  adSpend: null, calcStarts: null, calcCompletes: null, resultsCtaClicks: null, quoteFormStarts: null,
});

const addNullable = (a: number | null, b: number | null): number | null => (b === null ? a : (a ?? 0) + b);

export const rate = (num: number | null, den: number | null): number | null => (num === null || den === null || den === 0 ? null : num / den);

/** Value of one delivery: its own recorded price, else the buyer's current price, else unknown. */
export const deliveryPrice = (d: KpiDelivery, buyer: KpiBuyer | undefined): number | null => d.price ?? buyer?.price ?? null;

export function buildReport(leads: KpiLead[], deliveries: KpiDelivery[], buyers: KpiBuyer[], inputs: KpiInput[]): Report {
  const byBuyer = new Map(buyers.map((b) => [b.id, b]));
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const weeks = new Map<string, Row>();
  const sources = new Map<string, Row>();
  const total = emptyRow('all');
  const buyerRows = new Map<string, BuyerRow>();
  const get = (m: Map<string, Row>, k: string) => {
    let r = m.get(k);
    if (!r) m.set(k, (r = emptyRow(k)));
    return r;
  };

  for (const l of leads) {
    for (const r of [get(weeks, weekStart(l.created_at)), get(sources, sourceKey(l)), total]) {
      r.submissions++;
      if (l.phone_verified) r.verified++;
    }
  }

  // A lead counts as delivered when at least one buyer received it; returned when its status is 'returned'.
  const deliveredLeads = new Set<string>();
  for (const d of deliveries) {
    if (d.status !== 'delivered') continue;
    const l = leadById.get(d.lead_id);
    if (!l) continue; // lead outside the reporting window
    const price = deliveryPrice(d, byBuyer.get(d.buyer_id));
    const returned = l.status === 'returned';
    const first = !deliveredLeads.has(l.id);
    deliveredLeads.add(l.id);
    const b = buyerRows.get(d.buyer_id) ?? { id: d.buyer_id, name: byBuyer.get(d.buyer_id)?.name ?? 'unknown buyer', delivered: 0, returned: 0, revenue: { known: 0, unpriced: 0 } };
    buyerRows.set(d.buyer_id, b);
    b.delivered++;
    if (returned) b.returned++;
    // Revenue counts delivered, not-returned deliveries (a returned lead is credited back).
    const rows = [get(weeks, weekStart(l.created_at)), get(sources, sourceKey(l)), total];
    for (const r of rows) {
      if (first) {
        r.delivered++;
        if (returned) r.returned++;
      }
      if (!returned) {
        if (price === null) r.revenue.unpriced++;
        else r.revenue.known += price;
      }
    }
    if (!returned) {
      if (price === null) b.revenue.unpriced++;
      else b.revenue.known += price;
    }
  }

  // Owner-entered inputs. Enter EITHER one whole-week row (source '') OR one row per source for a given week, not
  // both: every row is added to its week and to the total, and named rows also to their source.
  for (const i of inputs) {
    const rows = [get(weeks, i.week_start), total, ...(i.source === '' ? [] : [get(sources, i.source.toLowerCase())])];
    for (const r of rows) {
      r.adSpend = addNullable(r.adSpend, i.ad_spend);
      r.calcStarts = addNullable(r.calcStarts, i.calc_starts);
      r.calcCompletes = addNullable(r.calcCompletes, i.calc_completes);
      r.resultsCtaClicks = addNullable(r.resultsCtaClicks, i.results_cta_clicks);
      r.quoteFormStarts = addNullable(r.quoteFormStarts, i.quote_form_starts);
    }
  }

  return {
    weeks: [...weeks.values()].sort((a, b) => (a.key < b.key ? 1 : -1)),
    sources: [...sources.values()].sort((a, b) => b.submissions - a.submissions || (a.key < b.key ? -1 : 1)),
    total,
    buyers: [...buyerRows.values()].sort((a, b) => b.delivered - a.delivered),
  };
}

export type TargetState = 'met' | 'missed' | 'no_data';

export const completionState = (r: number | null): TargetState => (r === null ? 'no_data' : r > TARGETS.completionRate ? 'met' : 'missed');
export const resultsToQuoteState = (r: number | null): TargetState => (r === null ? 'no_data' : r >= TARGETS.resultsToQuoteRate ? 'met' : 'missed');
export const returnState = (r: number | null): TargetState => (r === null ? 'no_data' : r < TARGETS.returnRate ? 'met' : 'missed');

/** Revenue minus ad spend, only when spend was entered. Unpriced deliveries make the revenue a floor, flagged by the caller. */
export const netOfSpend = (revenue: Money, adSpend: number | null): number | null => (adSpend === null ? null : revenue.known - adSpend);

export const pct = (r: number | null): string => (r === null ? 'n/a' : `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`);
export const usd = (n: number): string => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
