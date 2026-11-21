import type { APIRoute } from 'astro';
import { llmsCountries, renderCountryLlms } from '../../lib/seo/llms';
import { getSiteIndex, notFoundResponse, textResponse, unavailableResponse } from '../../lib/seo/site-index-load';

// /<cc>/llms.txt for every non-US country with indexable articles (/us/llms.txt has its own static route).
export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const idx = await getSiteIndex();
  if (!idx.ok || idx.value.length === 0) return unavailableResponse();
  const cc = params.cc ?? '';
  if (!/^[a-z]{2}$/.test(cc) || !llmsCountries(idx.value).includes(cc)) return notFoundResponse();
  return textResponse(renderCountryLlms(idx.value, cc));
};
