import type { APIRoute } from 'astro';
import { strictSameOrigin } from '../../../lib/admin/auth';
import { parseMediaRegistration } from '../../../lib/social/forms';
import { NOINDEX_HEADERS, guardAdmin } from '../../../lib/server/admin';
import { insertMedia, storageObjectExists } from '../../../lib/server/social-admin';
import { adminEnv } from '../../../lib/server/social-page';

// Owner-only. Registers a file the browser has just uploaded to Storage as a media library row.
export const prerender = false;

const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...NOINDEX_HEADERS, 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  const env = adminEnv();
  const denied = await guardAdmin(request, env);
  if (denied) return denied;
  if (!strictSameOrigin(request)) return new Response('Forbidden', { status: 403, headers: NOINDEX_HEADERS });
  const body = await request.json().catch(() => null);
  const v = parseMediaRegistration(body);
  if (!v.ok) return json({ error: v.errors[0] }, 400);
  if (!(await storageObjectExists(env, v.value.storage_path))) return json({ error: 'The uploaded file was not found in storage. Upload it again.' }, 400);
  const r = await insertMedia(env, v.value);
  if (!r.ok) return json({ error: r.error }, 500);
  const m = r.media;
  return json({ media: { id: m.id, kind: m.kind, public_url: m.public_url, mime: m.mime, bytes: m.bytes, width: m.width, height: m.height, duration_s: m.duration_s, alt_text: m.alt_text } });
};
