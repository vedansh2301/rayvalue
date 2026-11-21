import type { APIRoute } from 'astro';
import { renderRootLlms } from '../lib/seo/llms';
import { getSiteIndex, textResponse, unavailableResponse } from '../lib/seo/site-index-load';

export const prerender = false;

export const GET: APIRoute = async () => {
  const idx = await getSiteIndex();
  if (!idx.ok || idx.value.length === 0) return unavailableResponse();
  return textResponse(renderRootLlms(idx.value));
};
