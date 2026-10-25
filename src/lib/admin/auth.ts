/** Admin access (pure): HTTP Basic with a single shared password from ADMIN_PASSWORD. No cookies, no sessions. */
import { createHash, timingSafeEqual } from 'node:crypto';

export const MIN_ADMIN_PASSWORD_LENGTH = 12;

/** Admin is on only when the owner set a reasonably long password; otherwise the pages answer 404. */
export const adminConfigured = (password: string | undefined): password is string => typeof password === 'string' && password.length >= MIN_ADMIN_PASSWORD_LENGTH;

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Is the Authorization header valid Basic auth carrying the password? Username is ignored. Constant-time. */
export function checkBasicAuth(header: string | null, password: string): boolean {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header ?? '');
  if (!m) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(m[1]!, 'base64').toString('utf8');
  } catch {
    return false;
  }
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  return timingSafeEqual(digest(decoded.slice(i + 1)), digest(password));
}

/** State-changing admin requests must come from our own pages: browsers send credentials automatically with Basic auth. */
export function strictSameOrigin(request: Request): boolean {
  const own = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (origin) return origin === own;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}
