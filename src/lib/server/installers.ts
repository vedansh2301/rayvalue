/**
 * Which installers (active buyers) serve a ZIP. Calls the database function installers_for_zip with the publishable
 * key; the function returns only legal names. "Serviced" means at least one active buyer covers the ZIP.
 */
import { isSameOrigin } from './subscribe';
import { stateByPrefix } from '../calculator/zip';

export interface InstallersEnv {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
}

/** The installers' legal names serving the ZIP (possibly empty), or null when the lookup failed. */
export async function lookupInstallers(env: InstallersEnv, zip: string, state: string, fetchImpl: typeof fetch = fetch): Promise<string[] | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return null;
  try {
    const res = await fetchImpl(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/installers_for_zip`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_zip: zip, p_state: state }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`installers_for_zip: supabase status ${res.status}`);
      return null;
    }
    const body = await res.json().catch(() => null);
    if (!Array.isArray(body) || !body.every((n) => typeof n === 'string')) return null;
    return (body as string[]).slice(0, 3);
  } catch (e) {
    console.error('installers_for_zip: request failed', e instanceof Error ? e.name : 'error');
    return null;
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

/** GET /api/serviced?zip=33101 -> { ok, serviced, installers }. The state comes from the ZIP's prefix. */
export async function handleServiced(request: Request, env: InstallersEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const zip = new URL(request.url).searchParams.get('zip') ?? '';
  const state = /^\d{5}$/.test(zip) ? stateByPrefix(zip) : null;
  if (!state) return json(400, { ok: false, error: 'Enter a Florida or California ZIP code.' });
  const installers = await lookupInstallers(env, zip, state, fetchImpl);
  if (!installers) return json(502, { ok: false, error: 'Could not check coverage right now.' });
  return json(200, { ok: true, state, serviced: installers.length > 0, installers });
}
export { isSameOrigin };
