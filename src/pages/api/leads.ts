import type { APIRoute } from 'astro';
import { handleLead } from '../../lib/server/leads';

export const prerender = false;

/** POST /api/leads — see src/lib/server/leads.ts. */
export const POST: APIRoute = ({ request }) =>
  handleLead(
    request,
    // Runtime env (process.env); never import.meta.env, which Vite inlines into the bundle at build.
    {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
      // Server-only: leads are written with the service-role key (anon cannot insert into public.leads).
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      // Optional phone verification (all four needed, else the step is skipped).
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
