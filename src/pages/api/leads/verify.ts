import type { APIRoute } from 'astro';
import { handleVerify } from '../../../lib/server/verify';

export const prerender = false;

/** POST /api/leads/verify — SMS code send/check (Twilio Verify). See src/lib/server/verify.ts. */
export const POST: APIRoute = ({ request }) =>
  handleVerify(
    request,
    {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
      TWILIO_VERIFY_SERVICE_SID: process.env.TWILIO_VERIFY_SERVICE_SID,
      LEAD_SIGNING_SECRET: process.env.LEAD_SIGNING_SECRET,
    },
    fetch,
    ['https://rayvalue.com', 'https://www.rayvalue.com'],
  );

export const ALL: APIRoute = () =>
  new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: { Allow: 'POST', 'Content-Type': 'application/json' } });
