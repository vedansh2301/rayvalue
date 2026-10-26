/** Shared start of every /admin page: environment, access guard, no-index headers, admin-only CSP. */
import { applyAdminCsp, type CspDirective } from './admin-csp';
import { NOINDEX_HEADERS, guardAdmin } from './admin';
import type { SocialEnv } from './social-admin';

export type AdminEnvVars = SocialEnv & { ADMIN_PASSWORD?: string };

/** Read at request time from process.env (never import.meta.env, which would inline secrets). */
export const adminEnv = (): AdminEnvVars => ({
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  GITHUB_DISPATCH_TOKEN: process.env.GITHUB_DISPATCH_TOKEN,
});

interface PageContext {
  request: Request;
  response: { headers: Headers };
  csp?: { insertDirective: (d: CspDirective) => void };
}

/** null = continue rendering; otherwise return this Response. Sets no-index headers and the Supabase CSP sources. */
export async function adminPrelude(ctx: PageContext, env: AdminEnvVars): Promise<Response | null> {
  const denied = await guardAdmin(ctx.request, env);
  if (denied) return denied;
  for (const [k, v] of Object.entries(NOINDEX_HEADERS)) ctx.response.headers.set(k, v);
  applyAdminCsp(ctx.csp, env.SUPABASE_URL);
  return null;
}

/** 303 back to a page after a POST (post/redirect/get). */
export const redirectTo = (path: string) => new Response(null, { status: 303, headers: { ...NOINDEX_HEADERS, Location: path } });

export const forbidden = () => new Response('Forbidden', { status: 403, headers: NOINDEX_HEADERS });
