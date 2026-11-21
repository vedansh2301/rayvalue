import type { APIRoute } from 'astro';
import { SITEMAP_FILE_RE } from '../lib/seo/site-index';
import { getSiteIndex, notFoundResponse, unavailableResponse, xmlResponse } from '../lib/seo/site-index-load';
import { renderSitemaps } from '../lib/seo/sitemaps';

// /sitemap-us-cities.xml etc. Rendered on request so a newly published city is listed without a deploy.
export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const name = `sitemap-${params.cc}-${params.type}.xml`;
  if (!SITEMAP_FILE_RE.test(name)) return notFoundResponse();
  const idx = await getSiteIndex();
  if (!idx.ok || idx.value.length === 0) return unavailableResponse();
  const body = renderSitemaps(idx.value).files.get(name);
  return body ? xmlResponse(body) : notFoundResponse();
};
