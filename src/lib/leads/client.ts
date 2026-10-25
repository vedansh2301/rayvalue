/** Browser-side fetch helpers for the quote form and results actions (small; cached per page view). */
import type { State } from '../../data/schemas';
import type { StaffedHours } from './hours';

export interface ClientQuoteConfig {
  utilities: { id: string; name: string }[];
  call: { tel: string; display: string; hours: StaffedHours } | null;
}

const configCache = new Map<State, Promise<ClientQuoteConfig | null>>();

/** Utilities for the state's dropdown and the optional call link data. null on failure (callers degrade). */
export function fetchQuoteConfig(state: State): Promise<ClientQuoteConfig | null> {
  let p = configCache.get(state);
  if (!p) {
    p = fetch(`/api/quote-config?state=${state}`, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? (r.json() as Promise<ClientQuoteConfig & { ok?: boolean }>) : null))
      .then((b) => (b && Array.isArray(b.utilities) ? { utilities: b.utilities, call: b.call ?? null } : null))
      .catch(() => null);
    configCache.set(state, p);
  }
  return p;
}

export interface Serviced {
  serviced: boolean;
  installers: string[];
}

/** Which installers serve a ZIP. null when the check failed. */
export async function fetchServiced(zip: string): Promise<Serviced | null> {
  try {
    const r = await fetch(`/api/serviced?zip=${encodeURIComponent(zip)}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const b = (await r.json()) as { serviced?: unknown; installers?: unknown };
    if (typeof b.serviced !== 'boolean' || !Array.isArray(b.installers)) return null;
    return { serviced: b.serviced, installers: b.installers.filter((n): n is string => typeof n === 'string') };
  } catch {
    return null;
  }
}

/** Last four digits of a phone number as typed, for "we texted ••• 0123". */
export const lastFour = (phone: string): string => phone.replace(/\D/g, '').slice(-4);
