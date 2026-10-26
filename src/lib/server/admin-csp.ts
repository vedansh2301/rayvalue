/**
 * Extra Content-Security-Policy directives for admin pages only (media upload and preview). The public site keeps its
 * policy exactly: Astro's hashed `security.csp` plus the static header in vercel.json. On admin pages these directives
 * are merged into Astro's policy with Astro.csp.insertDirective, and vercel.json gives /admin its own static header
 * that names the same Supabase origin (the public header excludes /admin, otherwise the two policies would intersect).
 */
import type { AstroGlobal } from 'astro';

/** A CSP directive string such as "media-src 'self'" (Astro types the directive name). */
export type CspDirective = Parameters<NonNullable<AstroGlobal['csp']>['insertDirective']>[0];

/** The origin of the Supabase project (not secret), or null when SUPABASE_URL is missing or not https. */
export function supabaseOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** connect-src (browser -> Storage upload), img-src and media-src (previews, plus blob: for reading a local file's size). */
export function adminCspDirectives(supabaseUrl: string | undefined): CspDirective[] {
  const origin = supabaseOrigin(supabaseUrl);
  if (!origin) return ["media-src 'self' blob:", "img-src 'self' data: blob:"];
  return [`connect-src 'self' ${origin}`, `img-src 'self' data: blob: ${origin}`, `media-src 'self' blob: ${origin}`];
}

export function applyAdminCsp(csp: { insertDirective: (d: CspDirective) => void } | undefined, supabaseUrl: string | undefined): void {
  for (const d of adminCspDirectives(supabaseUrl)) csp?.insertDirective(d);
}
