/** Answer options of the quote form (values stored in public.leads; labels shown). Pure data + one mapping. */
export const BILL_BUCKETS = ['under_100', '100_150', '150_200', '200_300', '300_400', '400_plus'] as const;
export type BillBucket = (typeof BILL_BUCKETS)[number];
export const BILL_BUCKET_LABELS: Record<BillBucket, string> = {
  under_100: 'Under $100',
  '100_150': '$100–$150',
  '150_200': '$150–$200',
  '200_300': '$200–$300',
  '300_400': '$300–$400',
  '400_plus': '$400 or more',
};

/** The bucket a calculator bill (dollars per month) falls in, for prefilling. Lower bound inclusive. */
export function billToBucket(bill: number | null | undefined): BillBucket | null {
  if (typeof bill !== 'number' || !Number.isFinite(bill) || bill <= 0) return null;
  if (bill < 100) return 'under_100';
  if (bill < 150) return '100_150';
  if (bill < 200) return '150_200';
  if (bill < 300) return '200_300';
  if (bill < 400) return '300_400';
  return '400_plus';
}

export const SHADES = ['none', 'some', 'heavy', 'unsure'] as const;
export type Shade = (typeof SHADES)[number];
export const SHADE_LABELS: Record<Shade, string> = { none: 'None', some: 'Some', heavy: 'A lot', unsure: 'Not sure' };

export const ROOF_AGES = ['under_10', '10_20', '20_plus', 'unsure'] as const;
export type RoofAge = (typeof ROOF_AGES)[number];
export const ROOF_AGE_LABELS: Record<RoofAge, string> = { under_10: 'Under 10 years', '10_20': '10–20 years', '20_plus': 'Over 20 years', unsure: 'Not sure' };

export const BATTERY_INTERESTS = ['yes', 'no', 'unsure'] as const;
export type BatteryInterest = (typeof BATTERY_INTERESTS)[number];
export const BATTERY_INTEREST_LABELS: Record<BatteryInterest, string> = { yes: 'Yes', no: 'No', unsure: 'Not sure' };

/** Calculator battery count (0 / 1 / 2) -> the form's battery answer. */
export const batteryToInterest = (n: number | null | undefined): BatteryInterest | null => (n === 0 ? 'no' : n === 1 || n === 2 ? 'yes' : null);

export const PAY_METHODS = ['cash', 'loan', 'lease_ppa', 'unsure'] as const;
export type PayMethod = (typeof PAY_METHODS)[number];
export const PAY_METHOD_LABELS: Record<PayMethod, string> = { cash: 'Cash', loan: 'Loan', lease_ppa: 'Lease or PPA', unsure: 'Not sure' };

export const TIMELINES = ['asap', '1_3_months', '3_6_months', 'researching'] as const;
export type Timeline = (typeof TIMELINES)[number];
export const TIMELINE_LABELS: Record<Timeline, string> = {
  asap: 'As soon as possible',
  '1_3_months': '1–3 months',
  '3_6_months': '3–6 months',
  researching: 'Just researching',
};

/** Utility choice that means "not listed / other": stored as no utility. */
export const OTHER_UTILITY = 'other';
