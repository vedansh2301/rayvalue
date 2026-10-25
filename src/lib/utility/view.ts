/**
 * Pure view-model for utility pages (no fetching, no Astro). Every number comes from database rows through the
 * calculator engine (src/lib/calc) or is printed as stored; anything missing is null and shown as "being verified".
 */
import type { Assumptions, City, CityProduction, Costs, Utility } from '../../data/schemas';
import { calculate } from '../calc';
import type { CalcSuccess } from '../calc';
import { isHttpUrl, formatRate, pickProduction, utilityRateRows, type RateRow } from '../city/view';
import type { FaqItem } from '../content/faq';
import { STATE_SLUG, UTILITY_PAGES, type UtilityPageMeta } from './pages';

export const utilityExampleBills = (a: Assumptions | null): readonly number[] | null => a?.utility_example_bills?.value ?? null;

const CONFIDENCE_RANK = { city: 0, county: 1, indirect: 2 } as const;

/** The city (and so the ZIP) used for the worked examples: this utility's best-confirmed city, then display order. */
export function pickRepresentativeCity(cities: readonly City[], utilityId: string): City | null {
  const mine = cities.filter((c) => c.default_utility_id === utilityId);
  let best: City | null = null;
  for (const c of mine) if (!best || CONFIDENCE_RANK[c.utility_confidence] < CONFIDENCE_RANK[best.utility_confidence]) best = c;
  return best;
}

export interface ExampleResult extends Pick<CalcSuccess, 'size' | 'cost' | 'year1Savings' | 'paybackYears'> {}
export interface UtilityExampleRow {
  bill: number;
  battery: 0 | 1;
  /** null = being verified (missing data, or the calculation could not run) */
  result: ExampleResult | null;
}

export interface ExampleContext {
  utilities: readonly Utility[];
  costs: Costs;
  assumptions: Assumptions;
  lookupZip: (zip: string) => { state: 'FL' | 'CA' } | null;
}

/** Solar only and solar + 1 battery for each illustrative bill, at the representative city's ZIP and "some shading". Never throws. */
export function utilityExampleRows(
  utilityId: string,
  city: City | null,
  production: CityProduction | null,
  bills: readonly number[] | null,
  ctx: ExampleContext | null,
): UtilityExampleRow[] {
  if (!bills) return [];
  return bills.flatMap((bill) =>
    ([0, 1] as const).map((battery) => {
      if (!ctx || !city || !production) return { bill, battery, result: null };
      try {
        const r = calculate(
          { zip: city.coords_zcta, utilityId, avgMonthlyBill: bill, battery, shading: 'some' },
          { ...ctx, production: { annualKwhPerKw: production.annual_kwh_per_kw, monthlyKwhPerKw: production.monthly_kwh_per_kw } },
        );
        return { bill, battery, result: r.ok ? { size: r.size, cost: r.cost, year1Savings: r.year1Savings, paybackYears: r.paybackYears } : null };
      } catch {
        return { bill, battery, result: null };
      }
    }),
  );
}

/** A utility page is indexable only when the worked-examples table has at least one real result. */
export const isIndexable = (rows: readonly UtilityExampleRow[]): boolean => rows.some((r) => r.result !== null);

export interface ExportRules {
  paragraphs: string[];
  /** Export credit's own source (CA), when stored. */
  source: { url: string; date: string | null } | null;
}

/** Plain-language export rules for the utility's metering type, with stored figures only. */
export function exportRules(u: Utility, short: string): ExportRules {
  if (u.metering_type === 'retail_net_metering') {
    const min =
      u.minimum_monthly_bill !== null && (u.minimum_bill_basis === 'base_charges' || u.minimum_bill_basis === 'total_bill')
        ? `${short}’s tariff sets a minimum bill of $${u.minimum_monthly_bill} a month, so solar cannot take the bill below it.`
        : `${short}’s minimum monthly bill is still being verified.`;
    return {
      paragraphs: [
        `Florida uses retail net metering. In our model, each kilowatt-hour your panels make offsets one you would otherwise buy from ${short}, priced through its tiered rates month by month.`,
        `${min} The fixed monthly charge also still applies. Solar banked but unused at the end of the year is counted as worth nothing in our model, and net-metering rules can change, so ask your installer for ${short}’s current terms.`,
      ],
      source: null,
    };
  }
  const credit = u.avg_export_credit_per_kwh === null ? 'an average export credit that is still being verified' : `an average export credit of ${formatRate(u.avg_export_credit_per_kwh)}`;
  return {
    paragraphs: [
      `California uses net billing (often called NEM 3.0). Solar used at home saves at ${short}’s retail rate, and solar sent to the grid earns a lower export credit. Our model uses ${credit}${u.export_credit_note ? `. ${u.export_credit_note}` : '.'}`,
      'A battery raises the share of solar used at home instead of exported, which is why it affects California payback differently than it does in Florida.',
    ],
    source: isHttpUrl(u.export_credit_source_url) ? { url: u.export_credit_source_url, date: u.export_credit_verified_on } : null,
  };
}

const NO_CREDIT = 'The federal residential clean energy credit does not apply to installs in 2026 or later, so none is applied.';

/** 3-5 FAQ items built from this utility's stored data. Plain text (shown visibly and used for FAQPage JSON-LD). */
export function utilityFaq(u: Utility, meta: UtilityPageMeta, repCity: City | null): FaqItem[] {
  const { short } = meta;
  const items: FaqItem[] = [
    {
      id: 'credit',
      question: `Is there a federal tax credit for solar with ${short}?`,
      answer: `No. ${NO_CREDIT} Whether solar pays back with ${short} depends on your rates, your usage, your roof and your installer’s price.`,
    },
    {
      id: 'export',
      question: u.state === 'FL' ? `How does ${short} credit the solar I send to the grid?` : `What do I earn for solar I send to ${short}’s grid?`,
      answer:
        u.state === 'FL'
          ? `Florida uses retail net metering. In our model each kilowatt-hour your panels make offsets one you would buy from ${short}, and credit left over at the end of the year counts as worth nothing. Confirm ${short}’s current terms with your installer.`
          : `California uses net billing (NEM 3.0): solar used at home saves at the retail rate and solar sent to the grid earns a lower export credit${u.avg_export_credit_per_kwh === null ? ', which we are still verifying' : ` (our model uses an average of ${formatRate(u.avg_export_credit_per_kwh)}, an all-hours figure)`}.`,
    },
    {
      id: 'battery',
      question: `Will a battery shorten my payback with ${short}?`,
      answer:
        u.state === 'FL'
          ? 'In our Florida model a battery adds cost but no extra bill savings, because net metering already credits solar you send to the grid, so it lengthens payback. Homeowners add one mainly for backup power during outages.'
          : 'It can help or not depending on your rates and usage. A battery raises the share of solar you use at home instead of exporting it at the lower credit, but it also adds cost. The worked examples above show both cases.',
    },
    {
      id: 'examples',
      question: 'How are the worked examples calculated?',
      answer: `They come from the same calculator engine as the Florida and California calculators, using the rates, costs and assumptions listed on the methodology page${repCity ? `, the sun at a ${repCity.name} ZIP code` : ''}, and illustrative bills rather than ${short} averages. Your home will differ.`,
    },
    {
      id: 'source',
      question: `Where do the ${short} rates come from?`,
      answer: `From ${short}’s published ${u.rate_schedule} residential tariff information, read on ${u.verified_on}. The methodology page lists every source. Rates change, so check your latest bill.`,
    },
  ];
  return items;
}

export interface UtilityPageVm {
  meta: UtilityPageMeta;
  utility: Utility;
  repCity: City | null;
  rateRows: RateRow[];
  rules: ExportRules;
  bills: readonly number[] | null;
  examples: UtilityExampleRow[];
  analysisYears: number | null;
  faq: FaqItem[];
  indexable: boolean;
  calcHref: string;
  quotesHref: string;
  otherPages: UtilityPageMeta[];
}

export interface UtilityPageInput {
  meta: UtilityPageMeta;
  utilities: readonly Utility[];
  costs: Costs;
  assumptions: Assumptions;
  cities: readonly City[];
  production: readonly CityProduction[];
  lookupZip: ExampleContext['lookupZip'];
}

/** Assemble the page model. Returns null when the utility row is missing. */
export function buildUtilityPage(i: UtilityPageInput): UtilityPageVm | null {
  const utility = i.utilities.find((u) => u.id === i.meta.utilityId);
  if (!utility) return null;
  const repCity = pickRepresentativeCity(i.cities, utility.id);
  const prod = repCity ? pickProduction(i.production.filter((p) => p.slug === repCity.slug && p.state === repCity.state), i.assumptions) : null;
  const bills = utilityExampleBills(i.assumptions);
  const examples = utilityExampleRows(utility.id, repCity, prod, bills, { utilities: i.utilities, costs: i.costs, assumptions: i.assumptions, lookupZip: i.lookupZip });
  const stateSlug = STATE_SLUG[i.meta.state];
  return {
    meta: i.meta,
    utility,
    repCity,
    rateRows: utilityRateRows(utility),
    rules: exportRules(utility, i.meta.short),
    bills,
    examples,
    analysisYears: i.assumptions.analysis_years.value,
    faq: utilityFaq(utility, i.meta, repCity),
    indexable: isIndexable(examples),
    calcHref: `/calculator/${stateSlug}?utility=${utility.id}`,
    quotesHref: `/quotes?state=${i.meta.state}&source=utility:${i.meta.slug}`,
    otherPages: UTILITY_PAGES.filter((p) => p.state === i.meta.state && p.slug !== i.meta.slug),
  };
}
