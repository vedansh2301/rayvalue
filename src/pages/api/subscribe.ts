import type { APIRoute } from 'astro';
import { handleSubscribe } from '../../lib/server/subscribe';

export const prerender = false;

/** POST /api/subscribe — see src/lib/server/subscribe.ts. */
export const POST: APIRoute = ({ request }) =>
  handleSubscribe(
    request,
    // Runtime env (process.env); never import.meta.env, which Vite inlines into the bundle at build.
    {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    },
    fetch,
    ['https://rayvalue.com', 'https://www.rayvalue.com'],
  );

export const ALL: APIRoute = () =>
  new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: { Allow: 'POST', 'Content-Type': 'application/json' } });
