# Spec: Lead capture ("Get free installer quotes")

Owner decisions (2026-10-22): lead generation is the core goal. Leads are **stored in Supabase only** (owner forwards/sells manually from the dashboard). Consent covers **RayValue + up to 3 installers**. **Phone required.** **No public contact email yet** → deletion/privacy requests go through an on-site form stored in Supabase.

Binding: CLAUDE.md hard rules (1 no invented numbers in copy; 4 UI never does math; 6 disclosure; 7 no cookies — Vercel Analytics custom events are cookieless and allowed; 10 secrets). Hashed CSP: no inline styles/scripts. Server env via `process.env` only.

## 1. Data (migration `supabase/migrations/0004_leads.sql`, apply via psql with SUPABASE_DB_* from .dev.vars — shell only)

`public.leads`
| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| created_at | timestamptz default now() | |
| first_name | text not null, 1–60 chars | |
| email | citext not null, ≤254, email check | not unique (same person may re-submit) |
| phone | text not null | normalized E.164 US (`+1XXXXXXXXXX`), check `^\+1[2-9][0-9]{9}$` |
| zip | text not null `^[0-9]{5}$` | |
| state | text not null in ('FL','CA') | |
| utility_id | text null (fk utilities.id) | null = "not listed" |
| avg_monthly_bill | numeric null | |
| battery | smallint null check 0–2 | |
| shading | text null in ('none','some','heavy') | |
| homeowner | boolean not null | renters allowed to submit but flagged |
| timeline | text not null in ('asap','1_3_months','3_6_months','researching') | |
| estimate_snapshot | jsonb null | likely/low/high size, cost, payback, net savings as shown — copied from the calc result the user saw (no new math) |
| source | text not null | 'results' / 'quotes_page' / 'city:<state>/<slug>' / 'home' |
| page_path | text null | |
| consent_text | text not null | exact consent sentence shown at submit time |
| consent_version | text not null | e.g. '2026-10-22.1' |
| consent_at | timestamptz not null default now() | |
| user_agent | text null (≤300) | |
| status | text not null default 'new' check in ('new','contacted','sold','invalid','deleted') | owner workflow in dashboard |

`public.data_requests`: id, created_at, email (citext, required), request ('delete','access','correct','do_not_sell'), details text ≤1000, status default 'new'.

RLS on both; revoke all from anon/authenticated; **column-level INSERT** for anon on the user-supplied columns only (not status, id, created_at); insert-only policy `to anon with check (true)` plus check constraints; no SELECT/UPDATE/DELETE for anon. Verify via REST with the publishable key: insert 201, select/update/delete denied. Add both tables to `todo_verify`? No (not calculator data). Add to README "Where leads live".

## 2. API

`POST /api/leads` (`src/pages/api/leads.ts`, prerender=false; pure helpers `src/lib/server/leads.ts` with tests), same pattern as `/api/subscribe`:
- Same-origin check, body size cap, honeypot `website`, 8s timeout, `no-store`.
- Validate + normalize: first name trimmed; email lowercased; phone → digits, strip leading 1, require 10 digits, NANP rules → `+1…`; ZIP 5 digits and state matches ZIP prefix (reuse zip prefix helper); consent checkbox must be `on`/true else 400 with field error; `consent_text`/`consent_version` taken **from a server constant** (`src/lib/leads/consent.ts`), never from the client.
- Insert via PostgREST (`Prefer: return=minimal`). Success → 303 to `/quotes/thanks` (HTML form) or JSON `{ok:true}` (fetch).
- Errors → JSON `{ok:false, fieldErrors}` (400) / 502 generic. Never echo PII in logs.
`POST /api/data-requests`: same pattern for the privacy request form → 303 `/privacy/request/thanks`.

Firewall: the existing 30 req/min/IP rule on `/api/` covers these.

## 3. Consent copy (server constant, version '2026-10-22.1')
> By submitting, you agree that RayValue and up to 3 solar installers serving your area may contact you by phone (including calls and texts using automated technology), text or email about solar quotes. Consent is not a condition of purchase. Message and data rates may apply. You can opt out at any time. See our [Privacy Policy](/privacy).

Checkbox **unchecked by default**, required. Label = the full sentence (clickable). Keep an HTML comment `<!-- owner: legal review of consent before paid traffic -->`.

## 4. UI

Shared component `QuoteForm` (Preact; used inside the calculator island and as its own small island on /quotes and city pages; hydrate `client:visible`). Fields, in order:
1. First name (autocomplete=given-name)
2. Email (type=email, autocomplete=email)
3. Phone (type=tel, autocomplete=tel, inputmode=tel; format as you type is optional — validate on blur/submit)
4. ZIP (prefilled when known; on results it's locked-display with "Change" link back to the calculator)
5. Do you own this home? (Yes / No radio cards)
6. When are you hoping to go solar? (ASAP · 1–3 months · 3–6 months · Just researching) radio cards
7. Consent checkbox (required)
8. Primary button **"Get my free quotes"**; under it `text-sm text-stone-600`: "Free. No obligation. We never sell your data to anyone other than up to 3 installers you've agreed to hear from."
Hidden: honeypot, source, page_path; on results also utility_id, bill, battery, shading, estimate_snapshot (the displayed likely/low/high values from the existing result object).

States: default · field error (role=alert, focus first invalid, existing patterns) · submitting (button "Sending…", disabled) · success (inline: "Thanks, {first name}! Up to 3 local installers may reach out soon." — no response-time promise until the owner confirms one) · server error ("Something went wrong — please try again.").

Fire Vercel Analytics custom event `track('lead_submitted', { source, state })` on success (no PII).

### Placements (most → least intent)
1. **Calculator results** (FL + CA), directly under the hero metrics row (before Upfront cost): card `rounded-2xl border-2 border-sun-400 bg-sun-50 p-5 sm:p-6`, H3 "Get real quotes for this system", one line: "Compare free quotes from up to 3 installers near {ZIP}. Your estimate comes with you." then QuoteForm (prefilled). Also show for `missing_data` CA/TECO results ("We're still verifying rates — installers can still quote your home").
2. **Header**: amber pill button **"Get quotes"** → `/quotes`, right of Blog (desktop); on mobile it's the last item in the single-row nav, styled as a small primary button. Keep `min-h-11`.
3. **Home hero**: primary "Get free installer quotes" → `/quotes`, secondary-style "Check my payback" → `/calculator/florida`… (two state buttons from v1.1 move into the "Choose your state" cards; hero keeps one primary + one secondary). Each state card gets a text link "Get quotes in Florida/California →" `/quotes?state=FL|CA`.
4. **City pages**: replace "Run your own numbers" box with two actions: primary "Get quotes in {City}" (→ `/quotes?state=..&zip=<city ZIP if available else none>&source=city:…`) and secondary "Run my numbers" (calculator).
5. **`/quotes` page** (static shell + QuoteForm island): H1 "Get free solar quotes", 3 bullets (No obligation · Up to 3 local installers · Your data isn't sold to anyone else), state select if not in query (FL/CA), then form. Breadcrumbs. Indexable.
6. **`/quotes/thanks`**: noindex, confirmation + links to calculators/guides.
7. **`/privacy/request`** + thanks: data request form (email, request type, details). Privacy page text: replace "contact address coming soon" with a link to this form; add a "Quote requests" section describing what's collected, why, who it's shared with (up to 3 installers you consented to), retention ("until you ask us to delete it"), and how to request deletion. Keep noindex + legal-review comment.

Affiliate `offers` CTA remains as-is (inactive); disclosure rules unchanged.

## 5. Acceptance
- Insert a smoke lead and a smoke data request through the live preview, verify rows exist, then delete them (psql).
- Anon cannot read `leads`/`data_requests` (REST 401/42501).
- Results page at 390×844: lead card's H3 visible within ~1.5 screens of the results H2.
- Header "Get quotes" visible on every page at 390/1280/1920; no nav wrap at 390.
- Zero CSP/console errors; Lighthouse ≥95 perf/a11y on /, /quotes, /calculator/florida (with results not required).
- Tests for leads/data-request helpers (validation, phone normalization, consent constant, honeypot, origin), share of existing tests unchanged.
