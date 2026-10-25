/**
 * Optional consent-evidence vendor (TrustedForm). OFF by default: nothing loads unless PUBLIC_TRUSTEDFORM_ENABLED=true
 * at build time. TrustedForm's script records the visitor's session on the quote form, so enabling it first requires
 * amending CLAUDE.md rule 7, updating the privacy policy, and adding the CSP origins below to vercel.json
 * (docs/LAUNCH.md). When enabled, the certificate URL it produces is stored with each lead
 * (leads.trustedform_cert_url).
 */
export const TRUSTEDFORM_FIELD = 'trustedform_cert_url';

export const trustedFormEnabled = (flag: unknown): boolean => flag === true || flag === 'true';

export function trustedFormScriptUrl(nowMs: number): string {
  return `https://api.trustedform.com/trustedform.js?field=${TRUSTEDFORM_FIELD}&l=${nowMs}`;
}

/** CSP origins to add (build time) when enabled; empty when off. */
export function trustedFormCsp(enabled: boolean): { script: string[]; connect: string[]; img: string[] } {
  return enabled
    ? { script: ['https://api.trustedform.com'], connect: ['https://api.trustedform.com', 'https://cert.trustedform.com'], img: ['https://cert.trustedform.com'] }
    : { script: [], connect: [], img: [] };
}

/** Add the vendor script to the page once (browser only). */
export function loadTrustedForm(): void {
  if (document.getElementById('trustedform-script')) return;
  const s = document.createElement('script');
  s.id = 'trustedform-script';
  s.async = true;
  s.src = trustedFormScriptUrl(Date.now());
  document.head.appendChild(s);
}
