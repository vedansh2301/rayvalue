import { z } from 'zod';

/**
 * Schemas for everything in src/data/*.json. src/data/index.ts parses the JSON with
 * these at import time, so invalid data throws and fails `npm run build`.
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

export const TouRateSchema = z.object({
  label: z.string().min(1),
  rate_per_kwh: z.number().nonnegative().nullable(),
});
export type TouRate = z.infer<typeof TouRateSchema>;

/** A low / likely / high triple where each entry may be unknown. */
export const NullableRangeSchema = z
  .object({
    low: z.number().nullable(),
    likely: z.number().nullable(),
    high: z.number().nullable(),
  })
  .superRefine((r, ctx) => {
    const vals = [r.low, r.likely, r.high];
    const nums = vals.filter((v): v is number => v !== null);
    if (nums.some((v, i) => i > 0 && v < nums[i - 1]!)) {
      ctx.addIssue({ code: 'custom', message: 'range must satisfy low <= likely <= high' });
    }
  });
export type NullableRange = z.infer<typeof NullableRangeSchema>;

export const UtilitySchema = z
  .object({
    id: z.enum(['fpl', 'duke-fl', 'teco', 'pge', 'sce', 'sdge']),
    name: z.string().min(1),
    state: StateSchema,
    metering_type: z.enum(['retail_net_metering', 'nem3_net_billing']),
    rate_schedule: z.string().min(1),
    rate_type: z.enum(['tiered', 'tou_summary']),
    /** tiered only. For seasonal tariffs this is the main (summer) season. */
    tiers: TiersSchema.nullable(),
    /** tiered only, optional second season (Duke Energy Florida's winter rate). */
    winter_tiers: TiersSchema.nullable(),
    /** tou_summary only: the on/off-peak rates as read from the tariff. */
    tou_rates: z.array(TouRateSchema).min(1).nullable(),
    /** tou_summary only: effective average $/kWh, only if a primary source publishes it. */
    avg_rate_per_kwh: NullableRangeSchema.nullable(),
    tou_note: z.string().nullable(),
    /** CA only: $/kWh credit on baseline usage. */
    baseline_credit_per_kwh: z.number().nonnegative().nullable(),
    rate_note: z.string().nullable(),
    fixed_monthly_charge: z.number().nonnegative().nullable(),
    fixed_charge_note: z.string().nullable(),
    /** CA only (null for FL). */
    avg_export_credit_per_kwh: z.number().nonnegative().nullable(),
    ...provenanceShape,
  })
  .superRefine((u, ctx) => {
    if (u.rate_type === 'tiered') {
      if (!u.tiers) ctx.addIssue({ code: 'custom', path: ['tiers'], message: 'tiered utilities need tiers' });
      if (u.tou_rates || u.avg_rate_per_kwh) ctx.addIssue({ code: 'custom', path: ['tou_rates'], message: 'tiered utilities must not set TOU fields' });
    } else {
      if (!u.tou_rates) ctx.addIssue({ code: 'custom', path: ['tou_rates'], message: 'tou_summary utilities need tou_rates' });
      if (u.tiers || u.winter_tiers) ctx.addIssue({ code: 'custom', path: ['tiers'], message: 'tou_summary utilities must not set tiers' });
      if (u.avg_rate_per_kwh && !u.tou_note) ctx.addIssue({ code: 'custom', path: ['tou_note'], message: 'avg_rate_per_kwh needs a tou_note explaining its source' });
    }
    if (u.winter_tiers && !u.tiers) ctx.addIssue({ code: 'custom', path: ['winter_tiers'], message: 'winter_tiers requires tiers' });
    if (u.state === 'FL' && u.metering_type !== 'retail_net_metering') ctx.addIssue({ code: 'custom', path: ['metering_type'], message: 'FL utilities use retail_net_metering' });
    if (u.state === 'CA' && u.metering_type !== 'nem3_net_billing') ctx.addIssue({ code: 'custom', path: ['metering_type'], message: 'CA utilities use nem3_net_billing' });
    if (u.state === 'FL' && u.avg_export_credit_per_kwh !== null) ctx.addIssue({ code: 'custom', path: ['avg_export_credit_per_kwh'], message: 'export credit is CA only' });
    requireProvenanceWhenNumeric(u, ctx);
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
export const CostLineSchema = z
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
export type CostLine = z.infer<typeof CostLineSchema>;

export const StateCostsSchema = z.object({
  installed_cost_per_watt: CostLineSchema,
  battery_installed_cost: CostLineSchema,
  annual_rate_escalation: CostLineSchema,
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

export const AssumptionsSchema = z
  .object({
    pvwatts_system_loss_pct: assumption({
      none: z.number().min(0).max(60),
      some: z.number().min(0).max(60),
      heavy: z.number().min(0).max(60),
    }),
    target_offset: assumption({ low: Share, high: Share }),
    system_size_cap_kw: assumption({ value: z.number().positive() }),
    panel_degradation_per_year: assumption({ value: z.number().min(0).max(0.05) }),
    analysis_years: assumption({ value: z.number().int().min(1).max(50) }),
    ca_self_consumption_share: assumption({
      solar_only: ShareRangeSchema,
      solar_plus_1_battery: ShareRangeSchema,
      solar_plus_2_batteries: ShareRangeSchema,
    }),
  })
  .strict()
  .superRefine((a, ctx) => {
    const l = a.pvwatts_system_loss_pct;
    if (!(l.none <= l.some && l.some <= l.heavy)) ctx.addIssue({ code: 'custom', path: ['pvwatts_system_loss_pct'], message: 'losses must satisfy none <= some <= heavy' });
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
  /** City pages are noindex and out of the sitemap until the owner flips this. */
  published: z.boolean(),
});
export type City = z.infer<typeof CitySchema>;

export const CitiesFileSchema = z
  .object({
    coordinates_source: z.object({ description: z.string(), source_url: z.url(), verified_on: IsoDate }),
    cities: z.array(CitySchema).min(1),
  })
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    f.cities.forEach((c, i) => {
      const key = `${c.state}/${c.slug}`;
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['cities', i, 'slug'], message: `duplicate city ${key}` });
      seen.add(key);
    });
  });

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
