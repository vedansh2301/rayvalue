/** Admin lead list: filters, row shaping and the "mark returned" form (pure). */
import { LEAD_STATUSES, type LeadStatus } from '../routing/eligibility';
import { toCsv } from './csv';

export interface AdminDelivery {
  status: string;
  error: string | null;
  response_status: number | null;
  used_fallback: boolean;
  buyers: { name: string } | null;
}

export interface AdminLead {
  id: string;
  created_at: string;
  status: LeadStatus;
  status_reason: string | null;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string;
  phone_verified: boolean;
  zip: string;
  state: string;
  source: string;
  timeline: string;
  bill_bucket: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  fbclid: string | null;
  landing_page: string | null;
  referrer: string | null;
  consent_version: string;
  consent_at: string;
  trustedform_cert_url: string | null;
  duplicate_of: string | null;
  returned_at: string | null;
  return_reason: string | null;
  lead_deliveries: AdminDelivery[];
}

export const LIST_LIMIT = 200;
export const EXPORT_LIMIT = 5000;

export const ADMIN_SELECT =
  'id,created_at,status,status_reason,first_name,last_name,email,phone,phone_verified,zip,state,source,timeline,bill_bucket,utm_source,utm_medium,utm_campaign,utm_term,utm_content,gclid,fbclid,landing_page,referrer,consent_version,consent_at,trustedform_cert_url,duplicate_of,returned_at,return_reason,lead_deliveries(status,error,response_status,used_fallback,buyers(name))';

/** ?status=sent -> a valid status or null (all). */
export const statusFilter = (raw: string | null): LeadStatus | null => (raw && (LEAD_STATUSES as readonly string[]).includes(raw) ? (raw as LeadStatus) : null);

export const buyersOf = (l: AdminLead): string => l.lead_deliveries.map((d) => `${d.buyers?.name ?? 'unknown'} (${d.status}${d.used_fallback ? ', fallback email' : ''})`).join('; ');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReturnValidation = { ok: true; id: string; reason: string } | { ok: false; error: string };
/** The "mark returned" form: a lead id and a reason note (3 to 500 characters). */
export function validateReturn(f: URLSearchParams): ReturnValidation {
  const id = f.get('id') ?? '';
  const reason = (f.get('reason') ?? '').trim();
  if (!UUID_RE.test(id)) return { ok: false, error: 'Unknown lead.' };
  if (reason.length < 3) return { ok: false, error: 'Add a short reason note (at least 3 characters).' };
  if (reason.length > 500) return { ok: false, error: 'Reason is too long (500 characters max).' };
  return { ok: true, id, reason };
}

export function leadsCsv(rows: readonly AdminLead[]): string {
  return toCsv(rows, [
    { header: 'id', value: (l) => l.id },
    { header: 'created_at', value: (l) => l.created_at },
    { header: 'status', value: (l) => l.status },
    { header: 'status_reason', value: (l) => l.status_reason },
    { header: 'first_name', value: (l) => l.first_name },
    { header: 'last_name', value: (l) => l.last_name },
    { header: 'email', value: (l) => l.email },
    { header: 'phone', value: (l) => l.phone },
    { header: 'phone_verified', value: (l) => l.phone_verified },
    { header: 'state', value: (l) => l.state },
    { header: 'zip', value: (l) => l.zip },
    { header: 'timeline', value: (l) => l.timeline },
    { header: 'bill_bucket', value: (l) => l.bill_bucket },
    { header: 'source', value: (l) => l.source },
    { header: 'utm_source', value: (l) => l.utm_source },
    { header: 'utm_medium', value: (l) => l.utm_medium },
    { header: 'utm_campaign', value: (l) => l.utm_campaign },
    { header: 'utm_term', value: (l) => l.utm_term },
    { header: 'utm_content', value: (l) => l.utm_content },
    { header: 'gclid', value: (l) => l.gclid },
    { header: 'fbclid', value: (l) => l.fbclid },
    { header: 'landing_page', value: (l) => l.landing_page },
    { header: 'referrer', value: (l) => l.referrer },
    { header: 'buyers', value: buyersOf },
    { header: 'consent_version', value: (l) => l.consent_version },
    { header: 'consent_at', value: (l) => l.consent_at },
    { header: 'trustedform_cert_url', value: (l) => l.trustedform_cert_url },
    { header: 'duplicate_of', value: (l) => l.duplicate_of },
    { header: 'returned_at', value: (l) => l.returned_at },
    { header: 'return_reason', value: (l) => l.return_reason },
  ]);
}
