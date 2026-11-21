import type { APIRoute } from 'astro';
import { handleOut } from '../../../lib/server/affiliate-click';

export const prerender = false;

/** GET /go/out/<offer-slug>?p=/page/path — logs one cookieless click row, then 302s to the merchant. See src/lib/server/affiliate-click.ts. */
export const GET: APIRoute = ({ request, params }) =>
  handleOut(request, params.slug ?? '', { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY });
