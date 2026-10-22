import type { APIRoute } from 'astro';
import { handleDataRequest } from '../../lib/server/leads';

export const prerender = false;

/** POST /api/data-requests — see src/lib/server/leads.ts. */
export const POST: APIRoute = ({ request }) =>
  handleDataRequest(
    request,
    // Runtime env (process.env); never import.meta.env, which Vite inlines into the bundle at build.
    { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY },
    fetch,
    ['https://rayvalue.com', 'https://www.rayvalue.com'],
  );

export const ALL: APIRoute = () =>
  new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: { Allow: 'POST', 'Content-Type': 'application/json' } });
