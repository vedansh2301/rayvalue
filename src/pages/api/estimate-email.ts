import type { APIRoute } from 'astro';
import { handleEstimateEmail } from '../../lib/server/estimate';

export const prerender = false;

/** POST /api/estimate-email — see src/lib/server/estimate.ts. */
export const POST: APIRoute = ({ request }) =>
  handleEstimateEmail(
    request,
    {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      EMAIL_FROM: process.env.EMAIL_FROM,
      NURTURE_MAILING_ADDRESS: process.env.NURTURE_MAILING_ADDRESS,
      UNSUBSCRIBE_SECRET: process.env.UNSUBSCRIBE_SECRET,
    },
    fetch,
    ['https://rayvalue.com', 'https://www.rayvalue.com'],
  );

export const ALL: APIRoute = () =>
  new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: { Allow: 'POST', 'Content-Type': 'application/json' } });
