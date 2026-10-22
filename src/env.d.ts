/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_GSC_VERIFICATION?: string;
  /** Public contact address; unset = contact "coming soon" and no rate-alert signup (src/lib/contact.ts). */
  readonly PUBLIC_CONTACT_EMAIL?: string;
}

interface ImportMetaEnv {
  readonly NREL_API_KEY?: string;
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_PUBLISHABLE_KEY?: string;
}
