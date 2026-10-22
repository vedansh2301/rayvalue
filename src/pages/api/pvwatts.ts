import type { APIRoute } from 'astro';
import { handlePvwatts } from '../../lib/server/pvwatts';

export const prerender = false;

/** GET /api/pvwatts?lat=25.77&lon=-80.20&losses=14 — see src/lib/server/pvwatts.ts. */
export const GET: APIRoute = ({ request }) => handlePvwatts(request, process.env.NREL_API_KEY); // runtime env; never import.meta.env (inlined at build)
