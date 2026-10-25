/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_GSC_VERIFICATION?: string;
  /** Public contact address; unset = contact page links the privacy request form and there is no rate-alert signup (src/lib/contact.ts). */
  readonly PUBLIC_CONTACT_EMAIL?: string;
}

interface ImportMetaEnv {
  /** Optional ad/measurement tags, OFF unless set (src/lib/ads/config.ts). Setting any needs the rule-7 amendment + consent banner. */
  readonly PUBLIC_GA4_ID?: string;
  readonly PUBLIC_GOOGLE_ADS_ID?: string;
  readonly PUBLIC_META_PIXEL_ID?: string;
  readonly PUBLIC_GOOGLE_ADS_CALC_LABEL?: string;
  readonly PUBLIC_GOOGLE_ADS_QUOTE_LABEL?: string;
}

interface ImportMetaEnv {
  readonly NREL_API_KEY?: string;
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMetaEnv {
  /** Optional consent-evidence script (TrustedForm), OFF unless "true" (src/lib/leads/consent-vendor.ts). Setting it needs the rule-7 amendment + privacy policy update + vercel.json CSP. */
  readonly PUBLIC_TRUSTEDFORM_ENABLED?: string;
  /** Owner-confirmed response time shown on the thank-you page, e.g. "within 1 business day". Unset = no timing is stated. */
  readonly PUBLIC_RESPONSE_WINDOW?: string;
}
