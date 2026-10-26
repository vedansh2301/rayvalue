import type { APIRoute } from 'astro';
import { strictSameOrigin } from '../../../lib/admin/auth';
import { newStoragePath, validateUploadRequest } from '../../../lib/social/forms';
import { NOINDEX_HEADERS, guardAdmin } from '../../../lib/server/admin';
import { createSignedUpload } from '../../../lib/server/social-admin';
import { adminEnv } from '../../../lib/server/social-page';

// Owner-only. Hands the browser a one-time signed URL to upload straight to the Supabase `social` bucket
// (Vercel Functions cap request bodies at 4.5 MB, so files never pass through here).
export const prerender = false;

const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...NOINDEX_HEADERS, 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const env = adminEnv();
  const denied = await guardAdmin(request, env);
  if (denied) return denied;
  if (!strictSameOrigin(request)) return new Response('Forbidden', { status: 403, headers: NOINDEX_HEADERS });
  const body = await request.json().catch(() => null);
  const v = validateUploadRequest(body);
  if (!v.ok) return json({ error: v.errors[0] }, 400);
  const path = newStoragePath(new Date(), crypto.randomUUID(), v.value.mime);
  const signed = await createSignedUpload(env, path);
  if (!signed) return json({ error: 'Could not start the upload. Check the Supabase settings.' }, 502);
  return json({ path, url: signed.url });
};
