import type { APIRoute } from 'astro';
import { handleQuoteConfig } from '../../lib/server/quote-config';

export const prerender = false;

/** GET /api/quote-config?state=FL — utilities for the dropdown and the optional call link. */
export const GET: APIRoute = ({ request }) =>
  handleQuoteConfig(request, {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    CALL_NUMBER: process.env.CALL_NUMBER,
  });

export const ALL: APIRoute = () =>
  new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: { Allow: 'GET', 'Content-Type': 'application/json' } });
