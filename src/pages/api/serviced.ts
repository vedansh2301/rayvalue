import type { APIRoute } from 'astro';
import { handleServiced } from '../../lib/server/installers';

export const prerender = false;

/** GET /api/serviced?zip=33101 — which installers serve the ZIP. See src/lib/server/installers.ts. */
export const GET: APIRoute = ({ request }) =>
  handleServiced(request, { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY });

export const ALL: APIRoute = () =>
  new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: { Allow: 'GET', 'Content-Type': 'application/json' } });
