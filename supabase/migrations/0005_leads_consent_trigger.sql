-- RayValue: the database sets each lead's consent text, version and time itself, so a client holding the
-- publishable key cannot store a different consent sentence. The constants below must equal
-- src/lib/leads/consent.ts (CONSENT_TEXT / CONSENT_VERSION); a unit test checks this. When the consent
-- text changes: bump the version in consent.ts and add a migration that replaces this function.

create or replace function public.leads_set_consent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.consent_text := 'By submitting, you agree that RayValue and up to 3 solar installers serving your area may contact you by phone (including calls and texts using automated technology), text or email about solar quotes. Consent is not a condition of purchase. Message and data rates may apply. You can opt out at any time. See our Privacy Policy (/privacy).';
  new.consent_version := '2026-10-22.1';
  new.consent_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.leads_set_consent() from public, anon, authenticated;

drop trigger if exists leads_set_consent on public.leads;
create trigger leads_set_consent
  before insert on public.leads
  for each row
  execute function public.leads_set_consent();

-- anon may no longer supply the consent columns at all.
revoke insert (consent_text, consent_version) on table public.leads from anon;

notify pgrst, 'reload schema';
