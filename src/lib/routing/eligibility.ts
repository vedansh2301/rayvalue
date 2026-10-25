/**
 * Lead routing, dedupe and suppression rules (pure; no I/O). Inputs are plain rows already read from the database.
 * Spec: Phase 4 of the lead-capture build. Nothing here invents a value: a buyer with no price sorts last, a buyer with
 * no cap has no cap.
 */
import { BILL_BUCKETS, type BillBucket } from '../leads/options';
import { isStaffedNow } from '../leads/hours';

export const MAX_BUYERS_PER_LEAD = 3;
export const DEDUPE_WINDOW_DAYS = 30;

export type LeadStatus = 'new' | 'sent' | 'returned' | 'unserviced' | 'nurture' | 'disqualified' | 'duplicate';
export const LEAD_STATUSES: readonly LeadStatus[] = ['new', 'sent', 'returned', 'unserviced', 'nurture', 'disqualified', 'duplicate'];

export interface BuyerBusinessHours {
  timezone: string;
  days: number[];
  open: string;
  close: string;
}

export interface Buyer {
  id: string;
  created_at: string;
  name: string;
  legal_name: string;
  states: string[];
  zips: string[];
  active: boolean;
  accepted_timelines: string[];
  min_bill_bucket: string | null;
  homeowner_only: boolean;
  exclusive: boolean;
  daily_cap: number | null;
  price: number | string | null;
  delivery_method: 'email' | 'webhook' | 'crm';
  delivery_target: string | null;
  delivery_target_env: string | null;
  webhook_secret_env: string | null;
  fallback_email_env: string | null;
  business_hours: unknown;
}

/** The lead facts routing looks at. */
export interface RoutableLead {
  zip: string;
  state: string;
  homeowner: boolean;
  timeline: string;
  bill_bucket: string | null;
  /** legal_name of each installer named in the consent the person agreed to. */
  consented_installers: readonly string[];
}

/** Does the buyer cover this ZIP? An explicit ZIP list wins; an empty list means every ZIP in the buyer's states. */
export function coversZip(b: Pick<Buyer, 'zips' | 'states'>, zip: string, state: string): boolean {
  return b.zips.length > 0 ? b.zips.includes(zip) : b.states.includes(state);
}

/** Bill bucket order for the minimum check; unknown buckets never qualify. */
export function billMeets(bucket: string | null, min: string | null): boolean {
  if (min === null) return true;
  const i = BILL_BUCKETS.indexOf(bucket as BillBucket);
  const m = BILL_BUCKETS.indexOf(min as BillBucket);
  return i >= 0 && m >= 0 && i >= m;
}

export function parseBusinessHours(raw: unknown): BuyerBusinessHours | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.timezone !== 'string' || typeof o.open !== 'string' || typeof o.close !== 'string' || !Array.isArray(o.days)) return null;
  const days = o.days.filter((d): d is number => typeof d === 'number' && d >= 1 && d <= 7);
  return { timezone: o.timezone, open: o.open, close: o.close, days };
}

/** null hours = any time. Malformed hours count as closed (the delivery waits for the owner to fix them). */
export function withinBusinessHours(raw: unknown, now: Date): boolean {
  if (raw === null || raw === undefined) return true;
  const h = parseBusinessHours(raw);
  return h ? isStaffedNow(now, { timezone: h.timezone, days: h.days, open_time: h.open, close_time: h.close }) : false;
}

const priceOf = (b: Pick<Buyer, 'price'>): number => (b.price === null || b.price === '' ? -1 : Number(b.price));

/** Why a buyer is not eligible, or null when it is. Order is stable so the reason is deterministic. */
export function ineligibleReason(b: Buyer, lead: RoutableLead, deliveredToday: number): string | null {
  if (!b.active) return 'inactive';
  if (!coversZip(b, lead.zip, lead.state)) return 'zip';
  if (!lead.consented_installers.includes(b.legal_name)) return 'no_consent';
  if (b.homeowner_only && !lead.homeowner) return 'not_homeowner';
  if (b.accepted_timelines.length > 0 && !b.accepted_timelines.includes(lead.timeline)) return 'timeline';
  if (!billMeets(lead.bill_bucket, b.min_bill_bucket)) return 'bill';
  if (b.daily_cap !== null && deliveredToday >= b.daily_cap) return 'daily_cap';
  return null;
}

export interface RoutingDecision {
  /** Chosen buyers, best first. */
  buyers: Buyer[];
  /** true when the top buyer is exclusive, so only it was chosen. */
  exclusive: boolean;
}

/**
 * Choose up to 3 buyers (1 if the best is exclusive). Eligible buyers are ranked by price (highest first; unknown price
 * last), then oldest first. If the top-ranked buyer is exclusive it takes the lead alone; otherwise exclusive buyers are
 * skipped (an exclusive buyer would otherwise share the lead) and up to 3 shared buyers are chosen.
 */
export function chooseBuyers(buyers: readonly Buyer[], lead: RoutableLead, deliveredToday: ReadonlyMap<string, number>): RoutingDecision {
  const eligible = buyers
    .filter((b) => ineligibleReason(b, lead, deliveredToday.get(b.id) ?? 0) === null)
    .sort((a, b) => priceOf(b) - priceOf(a) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const top = eligible[0];
  if (!top) return { buyers: [], exclusive: false };
  if (top.exclusive) return { buyers: [top], exclusive: true };
  return { buyers: eligible.filter((b) => !b.exclusive).slice(0, MAX_BUYERS_PER_LEAD), exclusive: false };
}

/** Deliveries per buyer from rows already filtered to "today" (non-failed deliveries count toward the cap). */
export function countByBuyer(rows: readonly { buyer_id: string; status: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) if (r.status !== 'abandoned') m.set(r.buyer_id, (m.get(r.buyer_id) ?? 0) + 1);
  return m;
}

/** Start of the UTC day containing `now`, ISO. Daily caps reset at 00:00 UTC. */
export const utcDayStart = (now: Date): string => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

// ------------------------------------------------------------------ dedupe

export interface PriorLead {
  id: string;
  created_at: string;
  status: string;
  phone: string;
  email: string;
}

/** Earlier leads that make a new one a duplicate: same phone or same email (case-insensitive) within the window. */
export function findDuplicate(priors: readonly PriorLead[], lead: { phone: string; email: string }, now: Date, windowDays = DEDUPE_WINDOW_DAYS): PriorLead | null {
  const cutoff = now.getTime() - windowDays * 86_400_000;
  const email = lead.email.toLowerCase();
  const hits = priors.filter(
    (p) =>
      Date.parse(p.created_at) >= cutoff &&
      p.status !== 'duplicate' &&
      p.status !== 'disqualified' &&
      (p.phone === lead.phone || p.email.toLowerCase() === email),
  );
  hits.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return hits[0] ?? null;
}

/** ISO cutoff for the dedupe query. */
export const dedupeCutoff = (now: Date, windowDays = DEDUPE_WINDOW_DAYS): string => new Date(now.getTime() - windowDays * 86_400_000).toISOString();

// ------------------------------------------------------------------ Do Not Sell

/** Privacy request types that stop resale of a person's data. */
export const SUPPRESSING_REQUESTS: readonly string[] = ['do_not_sell', 'delete'];

/**
 * Is the lead suppressed? `emails` = the lead's email plus the emails of every other lead using the same phone
 * (data_requests carry an email only, so the phone is matched through earlier leads). `requests` = privacy requests
 * found for any of those emails. Rejected requests do not suppress.
 */
export function isSuppressed(requests: readonly { email: string; request: string; status: string }[], emails: readonly string[]): boolean {
  const set = new Set(emails.map((e) => e.toLowerCase()));
  return requests.some((r) => set.has(r.email.toLowerCase()) && SUPPRESSING_REQUESTS.includes(r.request) && r.status !== 'rejected');
}

// ------------------------------------------------------------------ final status

export type RoutingOutcome =
  | { kind: 'no_buyers' }
  | { kind: 'results'; delivered: number; queued: number; failed: number };

/** Lead status after routing: sent when at least one buyer has it or will (queued); otherwise unchanged ('new'). */
export function statusAfterRouting(o: RoutingOutcome): { status: 'new' | 'sent'; reason: string | null } {
  if (o.kind === 'no_buyers') return { status: 'new', reason: 'no_eligible_buyer' };
  if (o.delivered > 0 || o.queued > 0) return { status: 'sent', reason: null };
  return { status: 'new', reason: 'delivery_failed' };
}
