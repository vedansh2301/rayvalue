/**
 * Browser side of the global email sign-up: one POST to /api/subscribe. No calculator maths: it forwards the answers the
 * calculator already holds (allow-listed on the server) and never sends computed figures.
 */
import type { SignupCountry, SignupTopic } from '../i18n/signup';

export interface SignupRequest {
  email: string;
  country: SignupCountry;
  region?: string;
  topics: SignupTopic[];
  source: string;
  locale: 'en' | 'de';
  /** Calculator answers behind the report email (region, bill, battery, ...). */
  params?: Record<string, string>;
  /** Honeypot: stays empty for people. */
  website?: string;
}

export type SignupResult = { ok: true } | { ok: false; kind: 'invalid' | 'rate' | 'unavailable' | 'error'; field?: string };

export async function submitSignup(r: SignupRequest, fetchImpl: typeof fetch = fetch): Promise<SignupResult> {
  try {
    const res = await fetchImpl('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        email: r.email,
        country: r.country,
        ...(r.region ? { region: r.region } : {}),
        topics: r.topics,
        consent: true,
        source: r.source,
        locale: r.locale,
        ...(r.params && Object.keys(r.params).length ? { payload: { params: r.params } } : {}),
        website: r.website ?? '',
      }),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; field?: string } | null;
    if (res.ok && body?.ok) return { ok: true };
    if (res.status === 400) return { ok: false, kind: 'invalid', field: body?.field };
    if (res.status === 429) return { ok: false, kind: 'rate' };
    if (res.status === 503) return { ok: false, kind: 'unavailable' };
  } catch {
    // network error: fall through
  }
  return { ok: false, kind: 'error' };
}
