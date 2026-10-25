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
}

interface ImportMetaEnv {
  readonly NREL_API_KEY?: string;
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_PUBLISHABLE_KEY?: string;
}
