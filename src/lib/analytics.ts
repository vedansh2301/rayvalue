/**
 * Vercel Web Analytics `beforeSend`: drop the query string and fragment from every event URL.
 * Shared calculator links carry the ZIP code and bill in the query, which must not reach analytics.
 */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

export interface AnalyticsEvent {
  type: string;
  url: string;
  [k: string]: unknown;
}

export const beforeSend = <E extends AnalyticsEvent>(event: E): E => ({ ...event, url: stripQuery(event.url) });
