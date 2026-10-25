import type { APIRoute } from 'astro';
import { EXPORT_LIMIT, leadsCsv, statusFilter } from '../../lib/admin/leads';
import { NOINDEX_HEADERS, fetchAdminLeads, guardAdmin } from '../../lib/server/admin';

export const prerender = false;

const env = () => ({ SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD });

/** GET /admin/leads.csv[?status=sent] — Basic auth (ADMIN_PASSWORD). Contains personal data; never cached. */
export const GET: APIRoute = async ({ request }) => {
  const e = env();
  const denied = await guardAdmin(request, e);
  if (denied) return denied;
  const rows = await fetchAdminLeads(e, statusFilter(new URL(request.url).searchParams.get('status')), fetch, EXPORT_LIMIT);
  if (!rows) return new Response('Could not read leads', { status: 502, headers: NOINDEX_HEADERS });
  return new Response(leadsCsv(rows), {
    headers: { ...NOINDEX_HEADERS, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="rayvalue-leads-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
};
