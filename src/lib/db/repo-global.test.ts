/** Global loaders and schemas against a fake PostgREST with SYNTHETIC rows (never real values). */
import { describe, expect, it, vi } from 'vitest';
import { calculateGlobal } from '../calc/calculate-global';
import { caFixture } from '../calc/test-fixtures';
import { ExportPolicySchema, GlobalUtilitySchema, IncentiveSchema, MarketSchema } from '../../data/schemas-global';
import { utilityToRows } from './map';
import { createGlobalRepo, toGlobalCalcContext } from './repo-global';

const ENV = { url: 'https://fixture.supabase.co/', key: 'sb_publishable_FIXTUREKEY' };
const prov = { source_url: 'https://example.com/synthetic', verified_on: '2026-01-01', verification: 'agent_sourced' };

const market = (o: Record<string, unknown> = {}) => ({
  code: 'AU', name: 'Australia', currency: 'AUD', locale: 'en-AU', default_lang: 'en', yield_provider: 'pvgis', hemisphere: 'S',
  prices_include_tax: true, vat_rate: '0.1', vat_note: null, vat_source_url: prov.source_url, vat_verified_on: prov.verified_on, vat_verification: 'agent_sourced',
  display_round: null, display_round_rationale: null, published: false, ...o,
});
const usMarket = market({ code: 'US', name: 'United States', currency: 'USD', locale: 'en-US', yield_provider: 'pvwatts', hemisphere: 'N', prices_include_tax: false, vat_rate: null, vat_source_url: null, vat_verified_on: null, vat_verification: 'unverified', published: true });
const region = (country: string, code: string) => ({ country, code, name: code, slug: code.toLowerCase(), tax_note: null, published: false });

const policyRow = (o: Record<string, unknown> = {}) => ({
  id: 'au-nsw-feed-in', country: 'AU', region_code: 'NSW', name: 'Synthetic feed-in', kind: 'feed_in', true_up: null, note: null, source_url: null, verified_on: null, verification: 'unverified',
  export_policy_rates: [{ policy_id: 'au-nsw-feed-in', valid_from: '2026-07-01', valid_to: null, years_from: 1, years_to: null, rate_low: '0.03', rate_likely: '0.05', rate_high: '0.07', daily_cap_kwh: null, fio_b_per_kwh: null, fio_b_non_offset_share: null, note: null, ...prov }],
  ...o,
});
const incentiveRow = (o: Record<string, unknown> = {}) => ({
  id: 'au-nsw-rebate', country: 'AU', region_code: 'NSW', name: 'Synthetic rebate', administrator: null, applies_to: 'both', incentive_type: 'rebate', amount_type: 'per_kw',
  amount_low: null, amount_likely: 500, amount_high: null, cap_amount: null, cap_percent_of_cost: null, max_kw: null, max_kwh: null, taxable: false, excludes_export_kind: null,
  status: 'open', status_as_of: null, effective_from: null, effective_to: null, eligibility_note: null, note: null, ...prov, ...o,
});
const utilityRow = () => {
  const { utility, tierSets, touRates } = utilityToRows({ ...caFixture, name: 'Synthetic AU retailer' }, 0);
  return { ...utility, id: 'au-test', country: 'AU', region_code: 'NSW', state: 'NSW', export_policy_id: 'au-nsw-feed-in', utility_tier_sets: tierSets, utility_tou_rates: touRates };
};
const costRow = (item: string, likely: number) => ({ country: 'AU', region_code: 'NSW', state: 'NSW', item, low: null, likely, high: null, unit: 'AUD per watt (synthetic)', note: null, includes_tax: true, ...prov });
const assumptionRow = (key: string, value: Record<string, unknown>, o: Record<string, unknown> = {}) => ({ key, country: 'AU', state: null, value, rationale: 'synthetic test fixture value', ...o });
const range = (low: number, likely: number, high: number) => ({ low, likely, high });
const assumptionRows = () => [
  assumptionRow('pvwatts_system_loss_pct', { none: 14, some: 20, heavy: 30 }),
  assumptionRow('target_offset', { low: 0.9, high: 1 }),
  assumptionRow('system_size_cap_kw', { value: 15 }),
  assumptionRow('min_system_size_kw', { value: 2 }),
  assumptionRow('max_monthly_bill', { value: 5000 }),
  assumptionRow('panel_degradation_per_year', { value: 0 }),
  assumptionRow('analysis_years', { value: 25 }),
  assumptionRow('missing_range_spread', { value: 0.15 }),
  assumptionRow('annual_rate_escalation', range(0, 0.03, 0.05)),
  assumptionRow('self_consumption_share', { solar_only: range(0.3, 0.4, 0.5), solar_plus_1_battery: range(0.55, 0.7, 0.8), solar_plus_2_batteries: range(0.7, 0.85, 0.95) }),
  // a US row and a NSW override that must be handled by scope:
  assumptionRow('analysis_years', { value: 20 }, { country: 'US' }),
  assumptionRow('annual_rate_escalation', range(0.01, 0.02, 0.03), { state: 'NSW' }),
];

type Tables = Record<string, Record<string, unknown>[]>;
const tables = (): Tables => ({
  markets: [usMarket, market()],
  regions: [region('US', 'FL'), region('AU', 'NSW'), region('AU', 'VIC')],
  export_policies: [policyRow(), policyRow({ id: 'au-vic-feed-in', region_code: 'VIC', export_policy_rates: [] }), policyRow({ id: 'us-fl-net-metering', country: 'US', region_code: 'FL', kind: 'net_metering', true_up: 'forfeit', export_policy_rates: [] })],
  incentives: [incentiveRow(), incentiveRow({ id: 'au-vic-rebate', region_code: 'VIC' }), incentiveRow({ id: 'au-wide', region_code: null })],
  utilities: [utilityRow()],
  cost_ranges: [costRow('installed_cost_per_watt', 2), costRow('battery_installed_cost', 10000), { ...costRow('installed_cost_per_watt', 3), country: 'US', region_code: 'FL', state: 'FL', includes_tax: null }],
  model_assumptions: assumptionRows(),
});

function fakeRest(t: Tables = tables()) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    const table = u.pathname.replace('/rest/v1/', '');
    let rows = t[table] ?? [];
    for (const [k, v] of u.searchParams) {
      if (['select', 'order', 'limit'].includes(k)) continue;
      if (!v.startsWith('eq.')) throw new Error(`unsupported filter ${k}=${v}`);
      rows = rows.filter((r) => String(r[k]) === v.slice(3));
    }
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}
const repo = (t?: Tables) => createGlobalRepo({ env: ENV, fetch: fakeRest(t) as unknown as typeof fetch });

describe('markets and regions', () => {
  it('loads and validates a market (numeric strings are coerced)', async () => {
    const r = await repo().loadMarket('AU');
    expect(r.ok && r.value).toMatchObject({ code: 'AU', currency: 'AUD', vat_rate: 0.1, hemisphere: 'S', yield_provider: 'pvgis' });
    expect((await repo().loadMarkets()).ok).toBe(true);
  });
  it('rejects a VAT rate without a source, a rounding unit without a rationale, and a wrong yield provider', () => {
    expect(MarketSchema.safeParse(market({ vat_source_url: null })).success).toBe(false);
    expect(MarketSchema.safeParse(market({ vat_verification: 'unverified' })).success).toBe(false);
    expect(MarketSchema.safeParse(market({ display_round: 1000 })).success).toBe(false);
    expect(MarketSchema.safeParse(market({ display_round: 1000, display_round_rationale: 'INR amounts are large' })).success).toBe(true);
    expect(MarketSchema.safeParse(market({ yield_provider: 'pvwatts' })).success).toBe(false); // AU must use PVGIS
    expect(MarketSchema.safeParse({ ...usMarket, yield_provider: 'pvgis' }).success).toBe(false); // US must use PVWatts
    expect(MarketSchema.safeParse(market({ code: 'CA', yield_provider: 'pvwatts' })).success).toBe(true);
  });
  it('a market with an unknown VAT rate is valid (null stays null, listed in todo_verify_global)', async () => {
    const r = await repo({ ...tables(), markets: [market({ vat_rate: null, vat_source_url: null, vat_verified_on: null, vat_verification: 'unverified' })] }).loadMarket('AU');
    expect(r.ok && r.value.vat_rate).toBeNull();
  });
  it('lists only the requested country\'s regions; bad codes are not_found without a request', async () => {
    const f = fakeRest();
    const g = createGlobalRepo({ env: ENV, fetch: f as unknown as typeof fetch });
    const r = await g.loadRegions('AU');
    expect(r.ok && r.value.map((x) => x.code)).toEqual(['NSW', 'VIC']);
    expect(await g.loadMarket('Australia')).toMatchObject({ ok: false, error: { kind: 'not_found' } });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('export policies', () => {
  it('embeds rates, scopes to the region (country-wide policies stay), validates', async () => {
    const r = await repo().loadExportPolicies('AU', 'NSW');
    expect(r.ok && r.value.map((p) => p.id)).toEqual(['au-nsw-feed-in']);
    expect(r.ok && r.value[0]!.rates[0]).toMatchObject({ rate_likely: 0.05, valid_from: '2026-07-01' });
  });
  it('schema: true_up only on net_metering; numbers need provenance; ordering; kind list', () => {
    const p = policyRow();
    const parse = (o: Record<string, unknown>) => ExportPolicySchema.safeParse({ ...p, ...o, rates: (o.export_policy_rates as unknown[] | undefined) ?? p.export_policy_rates });
    expect(parse({}).success).toBe(true);
    expect(parse({ true_up: 'forfeit' }).success).toBe(false);
    expect(parse({ kind: 'wheeling' }).success).toBe(false);
    expect(parse({ export_policy_rates: [{ ...p.export_policy_rates[0], source_url: null }] }).success).toBe(false);
    expect(parse({ export_policy_rates: [{ ...p.export_policy_rates[0], rate_low: 0.09 }] }).success).toBe(false);
    for (const kind of ['net_metering', 'net_billing', 'feed_in', 'gross_metering', 'none', 'br_fio_b']) expect(parse({ kind, true_up: null }).success).toBe(true);
  });
});

describe('incentives', () => {
  it('region rows plus country-wide rows; other regions excluded', async () => {
    const r = await repo().loadIncentives('AU', 'NSW');
    expect(r.ok && r.value.map((i) => i.id).sort()).toEqual(['au-nsw-rebate', 'au-wide']);
  });
  it('rule 2: a US-wide tax credit that is still effective in 2026+ is rejected; one ended in 2025 is fine', () => {
    const credit = { country: 'US', region_code: null, incentive_type: 'tax_credit', name: '25D', amount_type: 'percent', amount_likely: 0.3 };
    expect(IncentiveSchema.safeParse(incentiveRow({ ...credit, effective_to: null })).success).toBe(false);
    expect(IncentiveSchema.safeParse(incentiveRow({ ...credit, effective_to: '2026-12-31' })).success).toBe(false);
    expect(IncentiveSchema.safeParse(incentiveRow({ ...credit, effective_to: '2025-12-31' })).success).toBe(true);
  });
  it('schema: numbers need provenance; an empty row must be unverified; storage needs battery', () => {
    expect(IncentiveSchema.safeParse(incentiveRow({ source_url: null })).success).toBe(false);
    expect(IncentiveSchema.safeParse(incentiveRow({ amount_likely: null, verification: 'agent_sourced', source_url: null, verified_on: null })).success).toBe(false);
    expect(IncentiveSchema.safeParse(incentiveRow({ amount_likely: null, verification: 'unverified', source_url: null, verified_on: null })).success).toBe(true);
    expect(IncentiveSchema.safeParse(incentiveRow({ amount_type: 'per_kwh_storage', applies_to: 'solar' })).success).toBe(false);
  });
});

describe('utilities, costs, assumptions (country scoped)', () => {
  it('utilities load through the widened schema (non-US id and region)', async () => {
    const r = await repo().loadGlobalUtilities('AU', 'NSW');
    expect(r.ok && r.value[0]).toMatchObject({ id: 'au-test', country: 'AU', region_code: 'NSW', export_policy_id: 'au-nsw-feed-in' });
  });
  it('the US UtilitySchema rules still apply to global rows (e.g. a flat-rate plan needs an avg rate record)', () => {
    const bad = { ...utilityRow(), avg_rate_likely: null, avg_rate_low: null, avg_rate_high: null, avg_rate_unit: null, avg_rate_verification: null, avg_rate_source_url: null, avg_rate_verified_on: null };
    expect(GlobalUtilitySchema.safeParse(bad).success).toBe(false);
  });
  it('costs for the requested region only, with the tax flag', async () => {
    const r = await repo().loadGlobalCosts('AU', 'NSW');
    expect(r.ok && r.value.installed_cost_per_watt).toMatchObject({ includes_tax: true, line: { likely: 2 } });
    expect(r.ok && r.value.battery_installed_cost.line.likely).toBe(10000);
  });
  it('assumptions: only this country\'s rows, and a region row overrides the country row', async () => {
    const country = await repo().loadGlobalAssumptions('AU');
    expect(country.ok && country.value.analysis_years.value).toBe(25);
    expect(country.ok && country.value.annual_rate_escalation.likely).toBe(0.03);
    const nsw = await repo().loadGlobalAssumptions('AU', 'NSW');
    expect(nsw.ok && nsw.value.annual_rate_escalation.likely).toBe(0.02);
  });
  it('an incomplete assumption set is invalid, not defaulted', async () => {
    const t = tables();
    t.model_assumptions = t.model_assumptions.filter((r) => r.key !== 'analysis_years');
    expect(await repo(t).loadGlobalAssumptions('AU')).toMatchObject({ ok: false, error: { kind: 'invalid' } });
  });
});

describe('inventory tables', () => {
  it('validate rows by table and filter by exact column values', async () => {
    const t = { ...tables(), legal_provisions: [{ id: 'au-x', country: 'AU', region_code: null, citation: 'Act 1', title: 'T', topic: 'net_metering', summary: 's', effective_on: null, sunset_on: null, last_amended_year: null, ...prov }] };
    const r = await repo(t).loadInventory('legal_provisions', { country: 'AU' });
    expect(r.ok && r.value).toHaveLength(1);
    const bad = { ...t, legal_provisions: [{ ...t.legal_provisions[0], source_url: null }] };
    expect(await repo(bad).loadInventory('legal_provisions')).toMatchObject({ ok: false, error: { kind: 'invalid' } });
    expect(await repo(t).loadInventory('legal_provisions', { 'country;drop': 'x' })).toMatchObject({ ok: false });
  });
  it('an empty table is a valid empty list (nothing seeded)', async () => {
    const r = await repo().loadInventory('incentive_programs');
    expect(r.ok && r.value).toEqual([]);
  });
});

describe('end to end: rows -> context -> calculateGlobal', () => {
  it('computes for a synthetic AU region from loaded rows, in AUD, applying the rebate', async () => {
    const cfg = await repo().loadGlobalCalcConfig('AU', 'NSW');
    if (!cfg.ok) throw new Error(JSON.stringify(cfg.error));
    const ctx = toGlobalCalcContext(cfg.value, 'au-test', { annualKwhPerKw: 1500 });
    if (!ctx.ok) throw new Error(JSON.stringify(ctx.error));
    const r = calculateGlobal({ utilityId: 'au-test', avgMonthlyBill: 200, battery: 0, shading: 'none', installDate: '2026-08-01' }, ctx.value);
    expect(r).toMatchObject({ ok: true, currency: 'AUD', country: 'AU', regionCode: 'NSW' });
    if (r.ok) {
      expect(r.incentivesApplied.map((i) => i.id).sort()).toEqual(['au-nsw-rebate', 'au-wide']);
      expect(r.upfrontIncentive.likely).toBeGreaterThan(0);
    }
  });
  it('a utility without an export policy is not_found, never defaulted', async () => {
    const t = tables();
    t.utilities = [{ ...utilityRow(), export_policy_id: null }];
    const cfg = await repo(t).loadGlobalCalcConfig('AU', 'NSW');
    if (!cfg.ok) throw new Error('config should load');
    expect(toGlobalCalcContext(cfg.value, 'au-test', { annualKwhPerKw: 1500 })).toMatchObject({ ok: false, error: { kind: 'not_found' } });
  });
});
