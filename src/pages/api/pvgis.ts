import type { APIRoute } from 'astro';
import { handlePvgis } from '../../lib/server/pvgis';

export const prerender = false;

/**
 * GET /api/pvgis?country=AU&lat=-33.87&lon=151.21&losses=14 — see src/lib/server/pvgis.ts.
 * Serves every market whose yield provider is PVGIS (markets.yield_provider); US and CA use /api/pvwatts.
 */
export const GET: APIRoute = ({ request }) => handlePvgis(request);
