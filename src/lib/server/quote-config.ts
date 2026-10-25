/**
 * GET /api/quote-config?state=FL -> { utilities: [{id,name}], call: { tel, display, hours } | null }
 * Everything the quote form and the results page need that lives in Supabase or env: the state's utilities
 * (for the dropdown) and, only when CALL_NUMBER is set and staffed hours exist for the state, the call link data.
 * The browser decides "open right now" with isStaffedNow (it knows the current time). Cached at the CDN for 5 min.
 */
import { parseCallNumber, type CallNumber, type StaffedHours } from '../leads/hours';
import { selectRows, type DbEnv } from '../db/client';
import { json } from './http';

export interface QuoteConfigEnv {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  /** The staffed phone number (owner). Unset or malformed = no call link. */
  CALL_NUMBER?: string;
}

export interface QuoteConfig {
  utilities: { id: string; name: string }[];
  call: (CallNumber & { hours: StaffedHours }) | null;
}

const CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';

export async function loadQuoteConfig(state: 'FL' | 'CA', env: QuoteConfigEnv, fetchImpl: typeof fetch = fetch): Promise<QuoteConfig | null> {
  const db: DbEnv | null = env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY ? { url: env.SUPABASE_URL, key: env.SUPABASE_PUBLISHABLE_KEY } : null;
  const number = parseCallNumber(env.CALL_NUMBER);
  const [utils, hours] = await Promise.all([
    selectRows<{ id: string; name: string }>(db, 'utilities', { select: 'id,name', state: `eq.${state}`, order: 'display_order.asc,id.asc' }, fetchImpl),
    number ? selectRows<StaffedHours>(db, 'staffed_hours', { select: 'timezone,days,open_time,close_time', state: `eq.${state}`, active: 'eq.true' }, fetchImpl) : Promise.resolve(null),
  ]);
  if (!utils.ok) return null;
  const h = hours && hours.ok ? hours.value[0] : undefined;
  return { utilities: utils.value, call: number && h ? { ...number, hours: h } : null };
}

export async function handleQuoteConfig(request: Request, env: QuoteConfigEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const state = new URL(request.url).searchParams.get('state');
  if (state !== 'FL' && state !== 'CA') return json(400, { ok: false, error: 'state must be FL or CA' });
  const cfg = await loadQuoteConfig(state, env, fetchImpl);
  if (!cfg) return json(502, { ok: false, error: 'Configuration unavailable.' });
  const res = json(200, { ok: true, ...cfg });
  res.headers.set('Cache-Control', CACHE);
  return res;
}
