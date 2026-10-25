/**
 * What the thank-you page knows about a just-submitted lead: the quote form saves this in sessionStorage (a browser
 * convenience; no cookies, never sent anywhere) and /quotes/thank-you reads it. Pure parsing here so it is testable.
 */
export interface LeadSummary {
  firstName: string;
  installers: string[];
  serviced: boolean;
  status: 'new' | 'unserviced' | 'nurture';
  phoneVerified: boolean;
  state: 'FL' | 'CA';
  /** Event source label ("results", "quotes_page", "home", "city"). */
  source: string;
  /** quote_submit already fired for this submission. */
  tracked: boolean;
}

export const SUMMARY_KEY = 'rv_lead_summary';

/** Event-property form of a lead source: all city pages share one label. */
export const eventSource = (source: string): string => (source.startsWith('city:') ? 'city' : source);

const STATUSES = ['new', 'unserviced', 'nurture'] as const;

export function parseSummary(raw: unknown): LeadSummary | null {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const status = STATUSES.find((s) => s === o.status);
  const installers = Array.isArray(o.installers) ? o.installers.filter((n): n is string => typeof n === 'string' && n.length <= 120).slice(0, 3) : [];
  if (!status || typeof o.firstName !== 'string' || o.firstName.length > 60 || (o.state !== 'FL' && o.state !== 'CA')) return null;
  return {
    firstName: o.firstName,
    installers,
    serviced: o.serviced === true,
    status,
    phoneVerified: o.phoneVerified === true,
    state: o.state,
    source: typeof o.source === 'string' ? o.source.slice(0, 100) : 'quotes_page',
    tracked: o.tracked === true,
  };
}

export function saveSummary(s: LeadSummary): void {
  try {
    sessionStorage.setItem(SUMMARY_KEY, JSON.stringify(s));
  } catch {
    /* storage can be unavailable (private mode); the thank-you page then shows its generic text */
  }
}

export function readSummary(): LeadSummary | null {
  try {
    return parseSummary(sessionStorage.getItem(SUMMARY_KEY));
  } catch {
    return null;
  }
}
