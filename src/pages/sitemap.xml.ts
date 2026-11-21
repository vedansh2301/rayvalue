import type { APIRoute } from 'astro';
import { getSiteIndex, unavailableResponse, xmlResponse } from '../lib/seo/site-index-load';
import { renderSitemaps } from '../lib/seo/sitemaps';

// The one URL submitted to search engines: a <sitemapindex> of root-level sitemap-<cc>-<type>.xml files.
export const prerender = false;

export const GET: APIRoute = async () => {
  const idx = await getSiteIndex();
  if (!idx.ok || idx.value.length === 0) return unavailableResponse();
  return xmlResponse(renderSitemaps(idx.value).index);
};
