import type { Timeline } from './options';

export type NewLeadStatus = 'new' | 'unserviced' | 'nurture';

/**
 * The status a fresh lead is saved with. A ZIP no active buyer serves is "unserviced" (kept so we can email the
 * person when we do); "Just researching" is "nurture" (not sold as a ready-to-buy lead); everything else is "new".
 */
export function leadStatus(p: { serviced: boolean; timeline: Timeline }): NewLeadStatus {
  if (!p.serviced) return 'unserviced';
  return p.timeline === 'researching' ? 'nurture' : 'new';
}
