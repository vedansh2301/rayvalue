import { z } from 'zod';

/**
 * Domain schemas for the calculator data. The VALUES live in Supabase (tables in
 * supabase/migrations/0002_calculator_data.sql); src/lib/db/map.ts turns rows into these
 * shapes and src/lib/db/repo.ts validates them with these schemas on every load
 * (`npm run db:check` runs the same validation against the live DB).
 *
 * Two kinds of numbers live in the data:
 *  - FACTS (rates, costs): carry provenance (source_url, verified_on, verification).
 *    Any record that holds a non-null number must name its source, a date, and
 *    must not be marked "unverified". Unknown values are null (see docs/TODO-VERIFY.md).
 *  - ASSUMPTIONS (product choices): `kind: "assumption"` plus a `rationale`, no source.
 */

export const StateSchema = z.enum(['FL', 'CA']);
export type State = z.infer<typeof StateSchema>;

export const VerificationSchema = z.enum(['agent_sourced', 'human_verified', 'unverified']);
export type Verification = z.infer<typeof VerificationSchema>;

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** Provenance fields shared by every sourced record. */
const provenanceShape = {
  source_url: z.url().nullable(),
  verified_on: IsoDate.nullable(),
  verification: VerificationSchema,
};

/** True if any value in the tree is a finite number (provenance fields are never numbers). */
function hasNumber(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasNumber);
  if (value && typeof value === 'object') return Object.values(value).some(hasNumber);
  return false;
}

/** A record that holds any number must be fully sourced. */
function requireProvenanceWhenNumeric<T extends { source_url: string | null; verified_on: string | null; verification: Verification }>(
  rec: T,
  ctx: z.RefinementCtx,
) {
  const { source_url, verified_on, verification, ...rest } = rec;
  if (!hasNumber(rest)) return;
  if (!source_url) ctx.addIssue({ code: 'custom', path: ['source_url'], message: 'a record with numbers needs source_url' });
  if (!verified_on) ctx.addIssue({ code: 'custom', path: ['verified_on'], message: 'a record with numbers needs verified_on' });
  if (verification === 'unverified') ctx.addIssue({ code: 'custom', path: ['verification'], message: 'a record with numbers cannot be "unverified"' });
}

/** An unsourced record must say so: no source and no date. */
function requireUnverifiedWhenEmpty<T extends { source_url: string | null; verified_on: string | null; verification: Verification }>(
  rec: T,
  ctx: z.RefinementCtx,
) {
  const { source_url, verified_on, verification, ...rest } = rec;
  if (hasNumber(rest)) return;
  if (verification !== 'unverified') ctx.addIssue({ code: 'custom', path: ['verification'], message: 'a record with no numbers must be "unverified"' });
  if (source_url || verified_on) ctx.addIssue({ code: 'custom', path: ['source_url'], message: 'a record with no numbers must not carry a source or date' });
}

// ---------------------------------------------------------------- utilities

export const TierSchema = z.object({
  /** Monthly tier ceiling in kWh; null for the last (open-ended) tier. */
  up_to_kwh: z.number().positive().nullable(),
  /** All-in $/kWh for usage in this tier. */
  rate_per_kwh: z.number().nonnegative().nullable(),
  /**
   * The BASE energy part of rate_per_kwh (excludes fuel and other clause charges). Only
   * needed when the utility's minimum bill applies to base charges; null otherwise/unknown.
   */
  base_rate_per_kwh: z.number().nonnegative().nullable(),
}).refine((t) => t.base_rate_per_kwh === null || t.rate_per_kwh === null || t.base_rate_per_kwh <= t.rate_per_kwh, {
  message: 'base_rate_per_kwh cannot exceed rate_per_kwh',
});
export type Tier = z.infer<typeof TierSchema>;

const TiersSchema = z.array(TierSchema).min(1).superRefine((tiers, ctx) => {
  let prev = 0;
  tiers.forEach((t, i) => {
    const last = i === tiers.length - 1;
    if (last && t.up_to_kwh !== null) ctx.addIssue({ code: 'custom', path: [i, 'up_to_kwh'], message: 'last tier must have up_to_kwh null' });
    if (!last) {
      if (t.up_to_kwh === null) ctx.addIssue({ code: 'custom', path: [i, 'up_to_kwh'], message: 'only the last tier may have up_to_kwh null' });
      else if (t.up_to_kwh <= prev) ctx.addIssue({ code: 'custom', path: [i, 'up_to_kwh'], message: 'tier ceilings must be strictly ascending' });
      else prev = t.up_to_kwh;
    }
  });
});

const MonthSchema = z.number().int().min(1).max(12);

/** One season's tier structure. FPL/TECO have a single all-year set; Duke has summer + winter. */
export const TierSetSchema = z.object({
  season: z.enum(['all_year', 'summer', 'winter']),
  /** Calendar months (1-12) this set applies to. */
  months: z.array(MonthSchema).min(1),
  tiers: TiersSchema,
});
export type TierSet = z.infer<typeof TierSetSchema>;

export const TouRateSchema = z.object({
  season: z.enum(['summer', 'winter']),
  period: z.enum(['peak', 'mid_peak', 'off_peak', 'super_off_peak']),
  day_type: z.enum(['all', 'weekday', 'weekend']),
  /** Calendar months (1-12) for this season, or null where the source does not state them. */
  months: z.array(MonthSchema).min(1).nullable(),
  /** Human-readable hours, e.g. "4-9 p.m."; display only. */
  hours: z.string().nullable(),
  /** All-in $/kWh. */
  rate_per_kwh: z.number().nonnegative().nullable(),
});
export type TouRate = z.infer<typeof TouRateSchema>;

/** A sourced low / likely / high line (own provenance), used for costs and average rates. */
export const SourcedRangeSchema = z
  .object({
    low: z.number().nonnegative().nullable(),
    likely: z.number().nonnegative().nullable(),
    high: z.number().nonnegative().nullable(),
    unit: z.string().min(1),
    note: z.string().nullable(),
    ...provenanceShape,
  })
  .superRefine((c, ctx) => {
    const nums = [c.low, c.likely, c.high].filter((v): v is number => v !== null);
    if (nums.some((v, i) => i > 0 && v < nums[i - 1]!)) ctx.addIssue({ code: 'custom', message: 'range must satisfy low <= likely <= high' });
    requireProvenanceWhenNumeric(c, ctx);
    requireUnverifiedWhenEmpty(c, ctx);
  });
export type SourcedRange = z.infer<typeof SourcedRangeSchema>;

export const UtilitySchema = z
  .object({
    id: z.enum(['fpl', 'duke-fl', 'teco', 'pge', 'sce', 'sdge']),
    name: z.string().min(1),
    state: StateSchema,
    metering_type: z.enum(['retail_net_metering', 'nem3_net_billing']),
    rate_schedule: z.string().min(1),
    rate_type: z.enum(['tiered', 'tou_summary']),
    /** tiered only: one set per season; months across sets must cover 1-12 exactly once. */
    tier_sets: z.array(TierSetSchema).min(1).nullable(),
    /** tou_summary only: the rates as read from the tariff, one entry per season/period/day type. */
    tou_rates: z.array(TouRateSchema).min(1).nullable(),
    /** tou_summary only: a PUBLISHED residential class average (own source); never computed here. */
    avg_rate_per_kwh: SourcedRangeSchema.nullable(),
    tou_note: z.string().nullable(),
    /** CA only: $/kWh credit on baseline usage. */
    baseline_credit_per_kwh: z.number().nonnegative().nullable(),
    rate_note: z.string().nullable(),
    fixed_monthly_charge: z.number().nonnegative().nullable(),
    fixed_charge_note: z.string().nullable(),
    /** Minimum monthly bill in $ (FL tiered only); null when none applies or it is unknown (see basis). */
    minimum_monthly_bill: z.number().nonnegative().nullable(),
    /**
     * What the minimum is compared against:
     *  - base_charges: fixed charge + base energy charges; clause charges are billed on top
     *    (FPL: "monthly base electric service costs fall below $30 ... minimum $30 base bill").
     *  - total_bill: fixed charge + all energy charges.
     *  - none: the tariff has no minimum bill.
     *  - not_applicable: not modeled (CA net billing uses an annual average rate).
     *  - null: unknown (the calculator then reports missing data for FL).
     */
    minimum_bill_basis: z.enum(['base_charges', 'total_bill', 'none', 'not_applicable']).nullable(),
    minimum_bill_note: z.string().nullable(),
    /** CA only (null for FL). Has its OWN provenance (export_credit_*), not the tariff's. */
    avg_export_credit_per_kwh: z.number().nonnegative().nullable(),
    /** Source of avg_export_credit_per_kwh (e.g. a CPUC report), separate from the tariff source_url. */
    export_credit_source_url: z.url().nullable(),
    export_credit_verified_on: IsoDate.nullable(),
    /** What the export credit figure is and its caveats (e.g. statewide all-hours average). */
    export_credit_note: z.string().nullable(),
    export_credit_verification: VerificationSchema,
    /** Set when the source is undated, old, or internally inconsistent; listed prominently in TODO-VERIFY. */
    source_caveat: z.string().nullable(),
    ...provenanceShape,
  })
  .superRefine((u, ctx) => {
    if (u.rate_type === 'tiered') {
      if (!u.tier_sets) ctx.addIssue({ code: 'custom', path: ['tier_sets'], message: 'tiered utilities need tier_sets' });
      else {
        const seen = new Map<number, number>();
        u.tier_sets.forEach((set) => set.months.forEach((m) => seen.set(m, (seen.get(m) ?? 0) + 1)));
        for (let m = 1; m <= 12; m++) {
          if (seen.get(m) !== 1) ctx.addIssue({ code: 'custom', path: ['tier_sets'], message: `month ${m} must be covered by exactly one tier set` });
        }
      }
      if (u.tou_rates || u.avg_rate_per_kwh) ctx.addIssue({ code: 'custom', path: ['tou_rates'], message: 'tiered utilities must not set TOU fields' });
    } else {
      if (!u.tou_rates) ctx.addIssue({ code: 'custom', path: ['tou_rates'], message: 'tou_summary utilities need tou_rates' });
      if (u.tier_sets) ctx.addIssue({ code: 'custom', path: ['tier_sets'], message: 'tou_summary utilities must not set tier_sets' });
      if (!u.avg_rate_per_kwh) ctx.addIssue({ code: 'custom', path: ['avg_rate_per_kwh'], message: 'tou_summary utilities need an avg_rate_per_kwh record (values may be null)' });
    }
    if (u.state === 'FL' && u.metering_type !== 'retail_net_metering') ctx.addIssue({ code: 'custom', path: ['metering_type'], message: 'FL utilities use retail_net_metering' });
    if (u.state === 'CA' && u.metering_type !== 'nem3_net_billing') ctx.addIssue({ code: 'custom', path: ['metering_type'], message: 'CA utilities use nem3_net_billing' });
    if (u.state === 'CA' && u.minimum_bill_basis !== 'not_applicable') ctx.addIssue({ code: 'custom', path: ['minimum_bill_basis'], message: 'CA utilities use minimum_bill_basis "not_applicable"' });
    if (u.state === 'FL' && u.minimum_bill_basis === 'not_applicable') ctx.addIssue({ code: 'custom', path: ['minimum_bill_basis'], message: 'FL utilities must state a minimum bill basis (or null if unknown)' });
    const hasMin = u.minimum_bill_basis === 'base_charges' || u.minimum_bill_basis === 'total_bill';
    if (!hasMin && u.minimum_monthly_bill !== null) ctx.addIssue({ code: 'custom', path: ['minimum_monthly_bill'], message: 'a minimum_monthly_bill needs basis base_charges or total_bill' });
    if (u.state === 'FL' && u.avg_export_credit_per_kwh !== null) ctx.addIssue({ code: 'custom', path: ['avg_export_credit_per_kwh'], message: 'export credit is CA only' });
    // avg_rate_per_kwh and the export credit carry their own provenance, so they are excluded from the record-level check.
    const {
      avg_rate_per_kwh: _avg,
      avg_export_credit_per_kwh: exportCredit,
      export_credit_source_url: exportUrl,
      export_credit_verified_on: exportDate,
      export_credit_note: _exportNote,
      export_credit_verification: exportVerification,
      ...rest
    } = u;
    requireProvenanceWhenNumeric(rest, ctx);
    if (exportCredit !== null) {
      if (!exportUrl) ctx.addIssue({ code: 'custom', path: ['export_credit_source_url'], message: 'an export credit needs export_credit_source_url' });
      if (!exportDate) ctx.addIssue({ code: 'custom', path: ['export_credit_verified_on'], message: 'an export credit needs export_credit_verified_on' });
      if (exportVerification === 'unverified') ctx.addIssue({ code: 'custom', path: ['export_credit_verification'], message: 'an export credit cannot be "unverified"' });
    }
  });
export type Utility = z.infer<typeof UtilitySchema>;
export type UtilityId = Utility['id'];

export const UtilitiesSchema = z.array(UtilitySchema).superRefine((list, ctx) => {
  const ids = new Set<string>();
  list.forEach((u, i) => {
    if (ids.has(u.id)) ctx.addIssue({ code: 'custom', path: [i, 'id'], message: `duplicate utility id ${u.id}` });
    ids.add(u.id);
  });
});

// -------------------------------------------------------------------- costs

/** One sourced cost line (low / likely / high) with its own provenance. */
export const CostLineSchema = SourcedRangeSchema;
export type CostLine = SourcedRange;

export const StateCostsSchema = z.object({
  installed_cost_per_watt: CostLineSchema,
  battery_installed_cost: CostLineSchema,
});
export type StateCosts = z.infer<typeof StateCostsSchema>;

export const CostsSchema = z.object({ FL: StateCostsSchema, CA: StateCostsSchema });
export type Costs = z.infer<typeof CostsSchema>;

// -------------------------------------------------------------- assumptions

/** Product choices, not facts: need a rationale, never a source. */
function assumption<S extends z.ZodRawShape>(shape: S) {
  return z
    .object({
      kind: z.literal('assumption'),
      rationale: z.string().min(10),
      ...shape,
    })
    .strict();
}

const Share = z.number().min(0).max(1);
const ShareRangeSchema = z
  .object({ low: Share, likely: Share, high: Share })
  .strict()
  .refine((r) => r.low <= r.likely && r.likely <= r.high, 'range must satisfy low <= likely <= high');

/** A low / likely / high range whose bounds may all be null ("not yet verified"). Ordering is checked in AssumptionsSchema. */
const nullableRange = {
  low: z.number().min(0).nullable(),
  likely: z.number().min(0).nullable(),
  high: z.number().min(0).nullable(),
};
const LEASE_PPA_KEYS = ['lease_monthly_per_kw', 'lease_annual_escalator', 'ppa_rate_per_kwh', 'ppa_annual_escalator'] as const;

export const AssumptionsSchema = z
  .object({
    pvwatts_system_loss_pct: assumption({
      none: z.number().min(0).max(60),
      some: z.number().min(0).max(60),
      heavy: z.number().min(0).max(60),
    }),
    target_offset: assumption({ low: Share, high: Share }),
    system_size_cap_kw: assumption({ value: z.number().positive() }),
    min_system_size_kw: assumption({ value: z.number().positive() }),
    max_monthly_bill: assumption({ value: z.number().positive() }),
    panel_degradation_per_year: assumption({ value: z.number().min(0).max(0.05) }),
    analysis_years: assumption({ value: z.number().int().min(1).max(50) }),
    annual_rate_escalation: assumption({ FL: ShareRangeSchema, CA: ShareRangeSchema }),
    ca_self_consumption_share: assumption({
      solar_only: ShareRangeSchema,
      solar_plus_1_battery: ShareRangeSchema,
      solar_plus_2_batteries: ShareRangeSchema,
    }),
    /** Placeholder ± spread around a sourced `likely` when a cost line's low/high bound is null. */
    missing_range_spread: assumption({ value: z.number().min(0).max(0.5) }),
    /**
     * Illustrative monthly bills (USD) for the city-page example-payback table. Model inputs, not facts.
     * Optional: when the row is missing the city page hides that table ("being verified"); the calculator is unaffected.
     */
    city_example_bills: assumption({ value: z.array(z.number().positive()).min(1).max(6) }).optional(),
    /**
     * Lease / PPA comparison inputs (all optional, bounds null until the owner enters verified market figures;
     * while null the results show explanatory text only). Units: lease_monthly_per_kw = USD per kW of system per
     * month in year 1; ppa_rate_per_kwh = USD per kWh in year 1; escalators = share per year (0.02 = 2%).
     */
    lease_monthly_per_kw: assumption(nullableRange).optional(),
    lease_annual_escalator: assumption(nullableRange).optional(),
    ppa_rate_per_kwh: assumption(nullableRange).optional(),
    ppa_annual_escalator: assumption(nullableRange).optional(),
    /**
     * PVWatts v8 array inputs used for every production estimate (live /api/pvwatts and the
     * precomputed fallback). module_type / array_type are PVWatts codes (see PVWATTS_* labels in src/lib/calc/text.ts).
     */
    pvwatts_array: assumption({
      tilt: z.number().min(0).max(90),
      azimuth: z.number().min(0).lt(360),
      module_type: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      array_type: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      dataset: z.enum(['nsrdb', 'tmy2', 'tmy3', 'intl']),
    }),
  })
  .strict()
  .superRefine((a, ctx) => {
    const l = a.pvwatts_system_loss_pct;
    if (!(l.none <= l.some && l.some <= l.heavy)) ctx.addIssue({ code: 'custom', path: ['pvwatts_system_loss_pct'], message: 'losses must satisfy none <= some <= heavy' });
    if (a.min_system_size_kw.value >= a.system_size_cap_kw.value) ctx.addIssue({ code: 'custom', path: ['min_system_size_kw'], message: 'min_system_size_kw must be below system_size_cap_kw' });
    if (a.city_example_bills?.value.some((b) => b > a.max_monthly_bill.value)) ctx.addIssue({ code: 'custom', path: ['city_example_bills'], message: 'example bills must not exceed max_monthly_bill' });
    for (const k of LEASE_PPA_KEYS) {
      const r = a[k];
      if (!r) continue;
      const set = [r.low, r.likely, r.high];
      const allNull = set.every((v) => v === null);
      const ok = allNull || (set.every((v) => v !== null) && r.low! <= r.likely! && r.likely! <= r.high!);
      if (!ok) ctx.addIssue({ code: 'custom', path: [k], message: 'set all of low, likely and high (low <= likely <= high), or leave all null' });
    }
    if (a.target_offset.low > a.target_offset.high) ctx.addIssue({ code: 'custom', path: ['target_offset'], message: 'target_offset.low must be <= high' });
  });
export type Assumptions = z.infer<typeof AssumptionsSchema>;

// ------------------------------------------------------------------- cities

export const CitySchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase kebab-case'),
  name: z.string().min(1),
  state: StateSchema,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** ZIP whose Census ZCTA internal point gives lat/lon. */
  coords_zcta: z.string().regex(/^\d{5}$/),
  default_utility_id: UtilitySchema.shape.id,
  utility_source_url: z.url(),
  /** What the source actually shows (city-level vs county-level confirmation). */
  utility_source_note: z.string().min(1),
  /** How well the source ties this city to the utility: city = names the city, county = names only its county, indirect = inferred from a related list. */
  utility_confidence: z.enum(['city', 'county', 'indirect']),
  /** City pages are noindex and out of the sitemap until the owner flips this. */
  published: z.boolean(),
  /** Owner-written local notes shown on the city page. */
  local_notes: z.array(z.string().min(1)).default([]),
  /** Owner-written intro (Markdown); null = TODO placeholder. */
  intro_md: z.string().nullable().default(null),
});
export type City = z.infer<typeof CitySchema>;

function noDuplicateCities(cities: readonly City[], ctx: z.RefinementCtx, path: (string | number)[] = []) {
  const seen = new Set<string>();
  cities.forEach((c, i) => {
    const key = `${c.state}/${c.slug}`;
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [...path, i, 'slug'], message: `duplicate city ${key}` });
    seen.add(key);
  });
}

export const CitiesSchema = z.array(CitySchema).superRefine((list, ctx) => noDuplicateCities(list, ctx));

export const CitiesFileSchema = z
  .object({
    coordinates_source: z.object({ description: z.string(), source_url: z.url(), verified_on: IsoDate }),
    cities: z.array(CitySchema).min(1),
  })
  .superRefine((f, ctx) => noDuplicateCities(f.cities, ctx, ['cities']));
export type CitiesFile = z.infer<typeof CitiesFileSchema>;

// --------------------------------------------------------------------- zips

export const ZipMapSchema = z.record(z.string().regex(/^\d{5}$/), z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]));
export type ZipMap = z.infer<typeof ZipMapSchema>;

export const ZipMetaSchema = z.object({
  source: z.string(),
  source_url: z.url(),
  gazetteer_year: z.number().int(),
  downloaded_on: IsoDate,
  fl_prefixes: z.string(),
  ca_prefixes: z.string(),
  fl_count: z.number().int().nonnegative(),
  ca_count: z.number().int().nonnegative(),
  note: z.string(),
});
export type ZipMeta = z.infer<typeof ZipMetaSchema>;

// ---------------------------------------------------------------- pvwatts

/** Precomputed PVWatts v8 output for 1 kW DC at one city and one `losses` percent (scripts/precompute-pvwatts.mjs). */
export const CityProductionSchema = z
  .object({
    state: StateSchema,
    slug: CitySchema.shape.slug,
    losses: z.number().min(0).max(60),
    annual_kwh_per_kw: z.number().positive(),
    monthly_kwh_per_kw: z.array(z.number().nonnegative()).length(12),
    fetched_on: IsoDate,
    source_url: z.url(),
    endpoint: z.url(),
    params: z.record(z.string(), z.union([z.string(), z.number()])),
    dataset_note: z.string(),
    key_kind: z.enum(['DEMO_KEY', 'api_key']),
  })
  .refine((p) => Math.abs(p.monthly_kwh_per_kw.reduce((a, b) => a + b, 0) - p.annual_kwh_per_kw) < 2, {
    message: 'monthly values must sum to the annual value',
  });
export type CityProduction = z.infer<typeof CityProductionSchema>;

export const CityProductionListSchema = z.array(CityProductionSchema).superRefine((list, ctx) => {
  const seen = new Set<string>();
  list.forEach((p, i) => {
    const key = `${p.state}/${p.slug}@${p.losses}`;
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [i], message: `duplicate production ${key}` });
    seen.add(key);
  });
});

// ------------------------------------------------------------------ offers

/** Partner offer shown with calculator results. Only active offers with a url are ever shown. */
export const OfferSchema = z
  .object({
    state: StateSchema,
    partner_name: z.string().min(1),
    url: z.url().startsWith('https://').nullable(),
    cta_text: z.string().min(1),
    active: z.boolean(),
  })
  .refine((o) => !o.active || o.url !== null, { message: 'an active offer needs a url', path: ['url'] });
export type Offer = z.infer<typeof OfferSchema>;
