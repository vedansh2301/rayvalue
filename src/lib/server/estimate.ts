/**
 * POST /api/estimate-email: "Email me this estimate". Stores the request (with the exact consent wording, version,
 * time and IP) and enrolls the address in the nurture list; sends the estimate through the email adapter when one
 * is configured. No phone number is collected. Also used by renters (who are not stored as leads) with source
 * "renter". Written with the server-only secret key.
 */
import { ESTIMATE_EMAIL_CONSENT_TEXT, ESTIMATE_EMAIL_CONSENT_VERSION } from '../leads/consent';
import { normalizeEmail, parseSnapshot } from '../leads/validate';
import { STATE_NAMES } from '../calculator/form';
import { adminInsert, adminUpdate, type AdminEnv } from './admin-db';
import { buildEstimateEmail, sendEmail, type EmailEnv } from './email';
import { clientIp, json, readBody } from './http';
import { isSameOrigin } from './subscribe';

export type EstimateEnv = AdminEnv & EmailEnv;

const SOURCE_RE = /^(results|quotes_page|renter)$/;
const truthy = (v: unknown) => v === true || v === 'on' || v === 'true' || v === 'yes';

export async function handleEstimateEmail(request: Request, env: EstimateEnv, fetchImpl: typeof fetch = fetch, extraAllowedOrigins: readonly string[] = []): Promise<Response> {
  if (!isSameOrigin(request, extraAllowedOrigins)) return json(403, { ok: false, error: 'Cross-origin requests are not allowed.' });
  const f = await readBody(request);
  if (!f) return json(400, { ok: false, fieldErrors: { form: 'Could not read the form. Please try again.' } });
  if (typeof f.website === 'string' && f.website.trim() !== '') return json(200, { ok: true, emailed: false });

  const email = normalizeEmail(f.email);
  const errors: Record<string, string> = {};
  if (!email) errors.email = 'Enter a valid email address, like name@example.com.';
  if (!truthy(f.consent)) errors.consent = 'Check the box to agree to receive the email.';
  if (Object.keys(errors).length) return json(400, { ok: false, fieldErrors: errors });

  const state = f.state === 'FL' || f.state === 'CA' ? f.state : null;
  const snapshot = parseSnapshot(f.estimate_snapshot);
  const source = typeof f.source === 'string' && SOURCE_RE.test(f.source) ? f.source : 'results';
  const ua = request.headers.get('user-agent');

  const saved = await adminInsert<{ id: string }>(
    env,
    'estimate_requests',
    {
      email,
      state,
      source,
      estimate_snapshot: snapshot,
      consent_text: ESTIMATE_EMAIL_CONSENT_TEXT,
      consent_version: ESTIMATE_EMAIL_CONSENT_VERSION,
      consent_ip: clientIp(request),
      user_agent: ua ? ua.slice(0, 300) : null,
      nurture: true,
    },
    fetchImpl,
  );
  if (!saved || 'conflict' in saved) return json(502, { ok: false, error: 'Something went wrong — please try again.' });

  const msg = buildEstimateEmail(email!, snapshot, state ? STATE_NAMES[state] : null);
  const result = msg ? await sendEmail(env, msg, fetchImpl) : 'disabled';
  const emailStatus = !msg ? 'skipped' : result === 'sent' ? 'sent' : result === 'failed' ? 'failed' : 'pending';
  if (emailStatus !== 'pending') await adminUpdate(env, 'estimate_requests', { id: `eq.${saved.row.id}` }, { email_status: emailStatus }, fetchImpl);
  return json(200, { ok: true, emailed: result === 'sent' });
}
