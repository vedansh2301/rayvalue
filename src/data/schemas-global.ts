import { z } from 'zod';
import { IsoDate, SourcedRangeSchema, VerificationSchema, provenanceShape, refineUtility, requireProvenanceWhenNumeric, requireUnverifiedWhenEmpty, utilityShape } from './schemas';

/**
 * Zod schemas for the global data model (migrations 0025-0029). Rows are validated in the SNAKE_CASE shape the
 * database returns, on every load (src/lib/db/repo-global.ts); src/lib/db/map-global.ts then turns validated rows
 * into the calculator's types. Same provenance rules as the US tables: a row that holds a number needs source_url +
 * verified_on and must not be "unverified"; a row with no numbers must say so.
 */

/** Postgres numeric can arrive as a string; null stays null. */
const nn = (inner: z.ZodNumber = z.number()) => z.preprocess((v) => (v === null || v === undefined ? null : Number(v)), inner.nullable());
const nonneg = nn(z.number().nonnegative());
const share = nn(z.number().min(0).max(1));
const Code = z.string().regex(/^[A-Z0-9-]{1,8}$/);
const Slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const Country = z.string().regex(/^[A-Z]{2}$/);
const Url = z.url();

// ------------------------------------------------------------------ markets

export const YieldProviderSchema = z.enum(['pvwatts', 'pvgis']);
export const HemisphereSchema = z.enum(['N', 'S']);

export const MarketSchema = z
  .object({
    code: Country,
    name: z.string().min(1),
    currency: z.string().regex(/^[A-Z]{3}$/),
    locale: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/),
    default_lang: z.string().regex(/^[a-z]{2,3}$/),
    yield_provider: YieldProviderSchema,
    hemisphere: HemisphereSchema,
    prices_include_tax: z.boolean().nullable(),
    vat_rate: nn(z.number().min(0).lt(1)),
    vat_note: z.string().nullable(),
    vat_source_url: Url.nullable(),
    vat_verified_on: IsoDate.nullable(),
    vat_verification: VerificationSchema,
    display_round: nn(z.number().int().positive()),
    display_round_rationale: z.string().nullable(),
    published: z.boolean(),
  })
  .superRefine((m, ctx) => {
    if (m.vat_rate !== null) {
      if (!m.vat_source_url) ctx.addIssue({ code: 'custom', path: ['vat_source_url'], message: 'a VAT rate needs vat_source_url' });
      if (!m.vat_verified_on) ctx.addIssue({ code: 'custom', path: ['vat_verified_on'], message: 'a VAT rate needs vat_verified_on' });
      if (m.vat_verification === 'unverified') ctx.addIssue({ code: 'custom', path: ['vat_verification'], message: 'a VAT rate cannot be "unverified"' });
    }
    if (m.display_round !== null && (m.display_round_rationale ?? '').length < 10) {
      ctx.addIssue({ code: 'custom', path: ['display_round_rationale'], message: 'display_round is an assumption and needs a rationale' });
    }
    // One provider per country, by rule: US and CA use PVWatts, everything else PVGIS.
    const pvwattsCountries = ['US', 'CA'];
    if (pvwattsCountries.includes(m.code) !== (m.yield_provider === 'pvwatts')) {
      ctx.addIssue({ code: 'custom', path: ['yield_provider'], message: 'PVWatts covers US and CA only; every other market uses PVGIS' });
    }
  });
export type Market = z.infer<typeof MarketSchema>;
export const MarketsSchema = z.array(MarketSchema);

export const RegionSchema = z.object({
  country: Country,
  code: Code,
  name: z.string().min(1),
  slug: Slug,
  tax_note: z.string().nullable(),
  published: z.boolean(),
});
export type Region = z.infer<typeof RegionSchema>;
export const RegionsSchema = z.array(RegionSchema);

// ----------------------------------------------------------- export policies

export const ExportKindSchema = z.enum(['net_metering', 'net_billing', 'feed_in', 'gross_metering', 'none', 'br_fio_b']);
export const TrueUpSchema = z.enum(['forfeit', 'pay_at_rate', 'carry']);

export const ExportPolicyRateSchema = z
  .object({
    id: z.string().optional(),
    policy_id: z.string().min(1),
    valid_from: IsoDate.nullable(),
    valid_to: IsoDate.nullable(),
    years_from: z.coerce.number().int().min(1),
    years_to: nn(z.number().int().min(1)),
    rate_low: nonneg,
    rate_likely: nonneg,
    rate_high: nonneg,
    daily_cap_kwh: nn(z.number().positive()),
    fio_b_per_kwh: nonneg,
    fio_b_non_offset_share: share,
    note: z.string().nullable(),
    ...provenanceShape,
  })
  .superRefine((r, ctx) => {
    const nums = [r.rate_low, r.rate_likely, r.rate_high].filter((v): v is number => v !== null);
    if (nums.some((v, i) => i > 0 && v < nums[i - 1]!)) ctx.addIssue({ code: 'custom', message: 'rates must satisfy low <= likely <= high' });
    if (r.valid_from && r.valid_to && r.valid_to < r.valid_from) ctx.addIssue({ code: 'custom', path: ['valid_to'], message: 'valid_to is before valid_from' });
    if (r.years_to !== null && r.years_to < r.years_from) ctx.addIssue({ code: 'custom', path: ['years_to'], message: 'years_to is before years_from' });
    const { id: _i, policy_id: _p, valid_from: _f, valid_to: _t, years_from: _yf, years_to: _yt, note: _n, ...numeric } = r;
    requireProvenanceWhenNumeric(numeric, ctx);
    requireUnverifiedWhenEmpty(numeric, ctx);
  });
export type ExportPolicyRate = z.infer<typeof ExportPolicyRateSchema>;

export const ExportPolicySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    country: Country,
    region_code: Code.nullable(),
    name: z.string().min(1),
    kind: ExportKindSchema,
    true_up: TrueUpSchema.nullable(),
    note: z.string().nullable(),
    ...provenanceShape,
    rates: z.array(ExportPolicyRateSchema).default([]),
  })
  .superRefine((p, ctx) => {
    if (p.true_up !== null && p.kind !== 'net_metering') ctx.addIssue({ code: 'custom', path: ['true_up'], message: 'true_up applies to net_metering only' });
    if (p.verification !== 'unverified' && (!p.source_url || !p.verified_on)) ctx.addIssue({ code: 'custom', path: ['source_url'], message: 'a verified policy needs source_url and verified_on' });
    for (const r of p.rates) if (r.policy_id !== p.id) ctx.addIssue({ code: 'custom', path: ['rates'], message: `rate row belongs to ${r.policy_id}, not ${p.id}` });
  });
export type ExportPolicyRecord = z.infer<typeof ExportPolicySchema>;
export const ExportPoliciesSchema = z.array(ExportPolicySchema);

// --------------------------------------------------------------- incentives

export const IncentiveSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    country: Country,
    region_code: Code.nullable(),
    name: z.string().min(1),
    administrator: z.string().nullable(),
    applies_to: z.enum(['solar', 'battery', 'both']),
    incentive_type: z.enum(['rebate', 'tax_credit', 'upfront_discount', 'annual_payment']),
    amount_type: z.enum(['per_kw', 'per_kwh_storage', 'flat', 'percent', 'annual_payment']),
    amount_low: nonneg,
    amount_likely: nonneg,
    amount_high: nonneg,
    cap_amount: nonneg,
    cap_percent_of_cost: share,
    max_kw: nn(z.number().positive()),
    max_kwh: nn(z.number().positive()),
    taxable: z.boolean().nullable(),
    excludes_export_kind: ExportKindSchema.nullable(),
    status: z.enum(['open', 'waitlist', 'closed', 'unknown']),
    status_as_of: IsoDate.nullable(),
    effective_from: IsoDate.nullable(),
    effective_to: IsoDate.nullable(),
    eligibility_note: z.string().nullable(),
    note: z.string().nullable(),
    ...provenanceShape,
  })
  .superRefine((i, ctx) => {
    const nums = [i.amount_low, i.amount_likely, i.amount_high].filter((v): v is number => v !== null);
    if (nums.some((v, k) => k > 0 && v < nums[k - 1]!)) ctx.addIssue({ code: 'custom', message: 'amounts must satisfy low <= likely <= high' });
    if (i.effective_from && i.effective_to && i.effective_to < i.effective_from) ctx.addIssue({ code: 'custom', path: ['effective_to'], message: 'effective_to is before effective_from' });
    if (i.amount_type === 'per_kwh_storage' && i.applies_to === 'solar') ctx.addIssue({ code: 'custom', path: ['applies_to'], message: 'per_kwh_storage applies to battery or both' });
    const hasNumber = [i.amount_low, i.amount_likely, i.amount_high, i.cap_amount, i.cap_percent_of_cost, i.max_kw, i.max_kwh].some((v) => v !== null);
    if (hasNumber) {
      if (!i.source_url) ctx.addIssue({ code: 'custom', path: ['source_url'], message: 'an incentive with numbers needs source_url' });
      if (!i.verified_on) ctx.addIssue({ code: 'custom', path: ['verified_on'], message: 'an incentive with numbers needs verified_on' });
      if (i.verification === 'unverified') ctx.addIssue({ code: 'custom', path: ['verification'], message: 'an incentive with numbers cannot be "unverified"' });
    } else if (i.verification !== 'unverified') {
      ctx.addIssue({ code: 'custom', path: ['verification'], message: 'an incentive with no numbers must be "unverified"' });
    }
    // CLAUDE.md rule 2: the US federal residential credit (25D) does not apply to 2026+ installs and must never load.
    if (i.country === 'US' && i.region_code === null && i.incentive_type === 'tax_credit' && (i.effective_to === null || i.effective_to >= '2026-01-01')) {
      ctx.addIssue({ code: 'custom', path: ['effective_to'], message: 'a US-wide tax credit must end before 2026-01-01 (federal 25D is not available for 2026+ installs)' });
    }
  });
export type IncentiveRecord = z.infer<typeof IncentiveSchema>;
export const IncentivesSchema = z.array(IncentiveSchema);

// ------------------------------------------------ inventory tables (0029)

const sourced = {
  source_url: Url,
  verified_on: IsoDate,
  verification: z.enum(['agent_sourced', 'human_verified']),
};
const status = z.enum(['open', 'waitlist', 'closed', 'unknown']);

export const IncentiveProgramSchema = z
  .object({
    id: Slug,
    country: Country,
    region_code: Code.nullable(),
    name: z.string().min(1),
    administrator: z.string().nullable(),
    eligibility_note: z.string().nullable(),
    status,
    status_as_of: IsoDate.nullable(),
    opens_on: IsoDate.nullable(),
    ends_on: IsoDate.nullable(),
    ...provenanceShape,
  })
  .superRefine((p, ctx) => {
    if (p.verification !== 'unverified' && (!p.source_url || !p.verified_on)) ctx.addIssue({ code: 'custom', path: ['source_url'], message: 'a verified programme needs source_url and verified_on' });
  });
export type IncentiveProgram = z.infer<typeof IncentiveProgramSchema>;

export const IncentiveProgramRateSchema = z
  .object({
    program_id: Slug,
    utility_id: z.string().nullable(),
    step: nn(z.number().int()),
    technology: z.enum(['storage', 'solar']),
    rate: nonneg,
    unit: z.enum(['per_kwh', 'per_kw', 'flat']).nullable(),
    cap_kwh: nn(z.number().positive()),
    cap_note: z.string().nullable(),
    ...provenanceShape,
  })
  .superRefine((r, ctx) => {
    if (r.rate !== null && r.unit === null) ctx.addIssue({ code: 'custom', path: ['unit'], message: 'a rate needs a unit' });
    const { program_id: _p, utility_id: _u, step: _s, technology: _t, unit: _un, cap_note: _c, ...numeric } = r;
    requireProvenanceWhenNumeric(numeric, ctx);
    requireUnverifiedWhenEmpty(numeric, ctx);
  });

export const ExportCreditPriceSchema = z.object({
  utility_id: z.string().min(1),
  vintage_year: z.number().int(),
  month: z.number().int().min(1).max(12),
  day_type: z.enum(['weekday', 'weekend']),
  hour: z.number().int().min(0).max(23),
  generation_per_kwh: nonneg,
  delivery_per_kwh: nonneg,
  lock_in_years: nn(z.number().int().positive()),
  ...sourced,
});

export const NetMeteringRuleSchema = z
  .object({
    utility_id: z.string().min(1),
    tariff_sheet: z.string().nullable(),
    annual_excess_payout_basis: z.string().nullable(),
    annual_excess_payout_per_kwh: nonneg,
    payout_month: nn(z.number().int().min(1).max(12)),
    tier1_max_kw: nn(z.number().positive()),
    tier2_max_kw: nn(z.number().positive()),
    tier3_max_kw: nn(z.number().positive()),
    tier_fee_note: z.string().nullable(),
    battery_net_metered: z.boolean().nullable(),
    battery_rule_sheet: z.string().nullable(),
    ...provenanceShape,
  })
  .superRefine((r, ctx) => {
    const numeric = { a: r.annual_excess_payout_per_kwh, b: r.payout_month, c: r.tier1_max_kw, d: r.tier2_max_kw, e: r.tier3_max_kw, f: r.battery_net_metered };
    const has = Object.values(numeric).some((v) => v !== null);
    if (has && (!r.source_url || !r.verified_on || r.verification === 'unverified')) ctx.addIssue({ code: 'custom', path: ['source_url'], message: 'a rule with values needs source_url, verified_on and a verified status' });
    if (!has && r.verification !== 'unverified') ctx.addIssue({ code: 'custom', path: ['verification'], message: 'a rule with no values must be "unverified"' });
  });

export const InstalledPriceStatSchema = z
  .object({
    country: Country,
    region_code: Code,
    install_year: z.number().int(),
    segment: z.enum(['pv_only', 'pv_storage', 'storage_only']),
    size_bin: z.enum(['all', 'lt5', '5to10', '10to15', 'gt15']),
    p20: nonneg,
    median: nonneg,
    p80: nonneg,
    n_systems: nn(z.number().int().nonnegative()),
    unit: z.string().min(1),
    includes_tax: z.boolean().nullable(),
    dollar_year: nn(z.number().int()),
    method_note: z.string().min(1),
    ...sourced,
  })
  .refine((s) => (s.p20 === null || s.median === null || s.p20 <= s.median) && (s.median === null || s.p80 === null || s.median <= s.p80), { message: 'p20 <= median <= p80' });

export const UtilityReliabilitySchema = z.object({
  utility_id: z.string().min(1),
  year: z.number().int(),
  saidi_with_med: nonneg,
  saidi_without_med: nonneg,
  saifi_with_med: nonneg,
  saifi_without_med: nonneg,
  caidi_with_med: nonneg,
  customers: nn(z.number().int().nonnegative()),
  standard: z.enum(['IEEE1366', 'other']).nullable(),
  ...sourced,
});

export const OutageEventSchema = z.object({
  id: z.string().optional(),
  country: Country,
  region_code: Code.nullable(),
  utility_id: z.string().nullable(),
  event_name: z.string().min(1),
  event_start: IsoDate.nullable(),
  peak_customers_out: nn(z.number().int().nonnegative()),
  restoration_days: nonneg,
  ...sourced,
});

export const LegalProvisionSchema = z.object({
  id: Slug,
  country: Country,
  region_code: Code.nullable(),
  citation: z.string().min(1),
  title: z.string().min(1),
  topic: z.enum(['sales_tax', 'property_tax', 'hoa_rights', 'net_metering', 'interconnection', 'federal_credit', 'consumer_protection']),
  summary: z.string().min(1),
  effective_on: IsoDate.nullable(),
  sunset_on: IsoDate.nullable(),
  last_amended_year: nn(z.number().int()),
  ...sourced,
});

export const MarketStatSchema = z.object({
  country: Country,
  geo_type: z.enum(['country', 'region', 'utility']),
  geo_id: z.string().min(1),
  metric: z.enum(['small_scale_solar_mw', 'net_metered_customers', 'net_metered_kw', 'storage_interconnections', 'avg_residential_price', 'battery_attach_rate']),
  period: z.string().min(1),
  value: nn(),
  unit: z.string().min(1),
  dataset: z.string().min(1),
  ...sourced,
});

// ------------------------------------------------------- global utilities / cost lines

/**
 * A utility (rate plan) in ANY market: the US UtilitySchema with its FL/CA-only enums widened. Every other rule of
 * UtilitySchema (tier coverage, provenance, minimum-bill rules) still applies. US rows load through the unchanged
 * UtilitiesSchema; this schema is for the multi-country loader.
 */
export const GlobalUtilitySchema = z
  .object({
    ...utilityShape,
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    state: z.string().min(1),
    metering_type: z.enum(['retail_net_metering', 'nem3_net_billing', 'net_billing', 'feed_in', 'gross_metering', 'none', 'br_fio_b']),
    /** tiered (FL), tou_summary (CA) or flat (one published unit rate + standing charge, e.g. the Ofgem price cap). */
    rate_type: z.enum(['tiered', 'tou_summary', 'flat']),
    country: Country,
    region_code: Code,
    export_policy_id: z.string().nullable(),
  })
  .superRefine(refineUtility);
export type GlobalUtility = z.infer<typeof GlobalUtilitySchema>;
export const GlobalUtilitiesSchema = z.array(GlobalUtilitySchema);

/** A cost line (low / likely / high with provenance) plus whether the price includes VAT/GST. */
export const GlobalCostLineSchema = z.object({ line: SourcedRangeSchema, includes_tax: z.boolean().nullable() });
export const GlobalCostsSchema = z.object({ installed_cost_per_watt: GlobalCostLineSchema, battery_installed_cost: GlobalCostLineSchema });
export type GlobalCosts = z.infer<typeof GlobalCostsSchema>;

// ------------------------------------------------- global assumptions (model_assumptions, country scoped)

const assumed = <S extends z.ZodRawShape>(shape: S) => z.object({ kind: z.literal('assumption'), rationale: z.string().min(10), ...shape }).strict();
const Sh = z.number().min(0).max(1);
const ShRange = z.object({ low: Sh, likely: Sh, high: Sh }).strict().refine((r) => r.low <= r.likely && r.likely <= r.high, 'range must satisfy low <= likely <= high');

/**
 * The assumptions the multi-country engine reads, for one market (a region row overrides the country row).
 * Same keys and value shapes as the US AssumptionsSchema where they overlap; annual_rate_escalation is one range
 * (not FL/CA keyed) and the self-consumption key is `self_consumption_share`.
 */
export const GlobalAssumptionsSchema = z
  .object({
    pvwatts_system_loss_pct: assumed({ none: z.number().min(0).max(60), some: z.number().min(0).max(60), heavy: z.number().min(0).max(60) }),
    target_offset: assumed({ low: Sh, high: Sh }),
    system_size_cap_kw: assumed({ value: z.number().positive() }),
    min_system_size_kw: assumed({ value: z.number().positive() }),
    max_monthly_bill: assumed({ value: z.number().positive() }),
    panel_degradation_per_year: assumed({ value: z.number().min(0).max(0.05) }),
    analysis_years: assumed({ value: z.number().int().min(1).max(50) }),
    missing_range_spread: assumed({ value: z.number().min(0).max(0.5) }),
    annual_rate_escalation: assumed({ low: Sh, likely: Sh, high: Sh }),
    self_consumption_share: assumed({ solar_only: ShRange, solar_plus_1_battery: ShRange, solar_plus_2_batteries: ShRange }),
    /** Usable kWh of one battery; optional: absent = unknown, so per-kWh storage incentives are skipped, never guessed. */
    battery_usable_kwh: assumed({ value: z.number().positive() }).optional(),
    /** Optional: output facing east/west or north as a share of south-facing output (applied to the yield by src/lib/calculator/uk.ts). */
    orientation_yield_factor: assumed({ east_west: ShRange, north: ShRange }).optional(),
    /** Optional: last install date the calculator offers (ISO date). Absent = no limit (the GB calculator). Used where the sourced rates/incentives end on a known date (DE, AU). */
    install_horizon: assumed({ until: IsoDate }).optional(),
  })
  .strict()
  .superRefine((a, ctx) => {
    const l = a.pvwatts_system_loss_pct;
    if (!(l.none <= l.some && l.some <= l.heavy)) ctx.addIssue({ code: 'custom', path: ['pvwatts_system_loss_pct'], message: 'losses must satisfy none <= some <= heavy' });
    if (a.min_system_size_kw.value >= a.system_size_cap_kw.value) ctx.addIssue({ code: 'custom', path: ['min_system_size_kw'], message: 'min_system_size_kw must be below system_size_cap_kw' });
    if (a.target_offset.low > a.target_offset.high) ctx.addIssue({ code: 'custom', path: ['target_offset'], message: 'target_offset.low must be <= high' });
    const e = a.annual_rate_escalation;
    if (!(e.low <= e.likely && e.likely <= e.high)) ctx.addIssue({ code: 'custom', path: ['annual_rate_escalation'], message: 'range must satisfy low <= likely <= high' });
  });
export type GlobalAssumptionsRecord = z.infer<typeof GlobalAssumptionsSchema>;

// ------------------------------------------------------------ date-effective VAT (0035)

/** VAT/GST on installed solar or batteries for a date window. Always sourced: no row without source_url + verified_on. */
export const VatRateSchema = z
  .object({
    id: Slug,
    country: Country,
    applies_to: z.enum(['solar', 'battery']),
    rate: z.preprocess((v) => (v === null || v === undefined ? v : Number(v)), z.number().min(0).lt(1)),
    valid_from: IsoDate.nullable(),
    valid_to: IsoDate.nullable(),
    note: z.string().nullable(),
    source_url: Url,
    publisher: z.string().nullable(),
    verified_on: IsoDate,
    verification: z.enum(['agent_sourced', 'human_verified']),
  })
  .refine((r) => !r.valid_from || !r.valid_to || r.valid_to >= r.valid_from, { path: ['valid_to'], message: 'valid_to is before valid_from' });
export type VatRate = z.infer<typeof VatRateSchema>;
export const VatRatesSchema = z.array(VatRateSchema);

/** The point whose solar yield stands for a calculator region (one per utility). */
export const CalcLocationSchema = z.object({
  id: Slug,
  country: Country,
  region_code: Code,
  utility_id: z.string().min(1),
  name: z.string().min(1),
  lat: z.preprocess((v) => Number(v), z.number().min(-90).max(90)),
  lon: z.preprocess((v) => Number(v), z.number().min(-180).max(180)),
  coord_source_url: Url,
  verified_on: IsoDate,
  verification: z.enum(['agent_sourced', 'human_verified']),
  note: z.string().nullable(),
});
export type CalcLocation = z.infer<typeof CalcLocationSchema>;
export const CalcLocationsSchema = z.array(CalcLocationSchema);

/** Table name -> row-array schema for the generic inventory loader. */
export const INVENTORY_SCHEMAS = {
  incentive_programs: z.array(IncentiveProgramSchema),
  incentive_program_rates: z.array(IncentiveProgramRateSchema),
  export_credit_prices: z.array(ExportCreditPriceSchema),
  net_metering_rules: z.array(NetMeteringRuleSchema),
  installed_price_stats: z.array(InstalledPriceStatSchema),
  utility_reliability: z.array(UtilityReliabilitySchema),
  outage_events: z.array(OutageEventSchema),
  legal_provisions: z.array(LegalProvisionSchema),
  market_stats: z.array(MarketStatSchema),
} as const;
export type InventoryTable = keyof typeof INVENTORY_SCHEMAS;
export type InventoryRows<T extends InventoryTable> = z.infer<(typeof INVENTORY_SCHEMAS)[T]>;
