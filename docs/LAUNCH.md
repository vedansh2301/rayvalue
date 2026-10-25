# RayValue launch checklist (owner)

Hosting: Vercel project `rayvalue` (team vedanshs-projects-5b6aa829). Repo: github.com/vedansh2301/rayvalue (already connected; production branch `main`). Node 24 (`.nvmrc`).

## 1. Vercel
- [ ] Environment variables (Project > Settings > Environment Variables), all environments: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `NREL_API_KEY` (all set). Optional build var: `PUBLIC_GSC_VERIFICATION`.
- [ ] **`PUBLIC_CONTACT_EMAIL`** (build time, public): the address readers use to reach you and to ask for their email to be deleted. Not set yet (owner decision). While it is unset, /contact points to the privacy request form, the rate-alerts signup is not shown on any page, and `/api/subscribe` refuses signups (no email is collected without a deletion path). Set it in Vercel and redeploy to turn alerts on; the address then appears as a mailto link on /contact and /privacy.
- [ ] Owner copy still to write (/about, /terms and /affiliate-disclosure carry a first draft (attorney review needed; /about has {{PLACEHOLDER}} fields to fill), are noindex and out of the sitemap; each has an `OWNER:` comment): /about, /contact, /terms, /affiliate-disclosure. /privacy is an accurate factual draft of current data practices awaiting legal review. To publish one, write it and remove its path from `src/lib/seo/unreviewed-pages.ts`. /methodology is indexed and factual; it carries a `TODO: owner review` comment.
- [ ] Guides: both starter guides are `draft: true` (not built, no OG image, not in the sitemap). /guides stays noindex while empty. The header Guides and Blog links are hidden until each collection has at least 3 published (non-draft) items (`NAV_MIN_PUBLISHED` in `src/lib/nav.ts`); the routes and footer links stay.
- [ ] Never add `SUPABASE_DB_*` to Vercel. `SUPABASE_SECRET_KEY` is now REQUIRED in Vercel (Production + Preview) for lead capture (`/api/leads`, `/api/estimate-email`, `/api/leads/verify`): it is read only from `process.env` in those server routes, never sent to the browser. Rotate it if it ever leaks.
- [ ] Merge `build/v1` (and the phase branches) into `main`; Vercel deploys `main` to production automatically.
- [ ] Domain: rayvalue.com is primary and live; `www.rayvalue.com` redirects with 308. Confirm in Settings > Domains. HTTPS is automatic.
- [ ] Pre-launch `X-Robots-Tag: noindex` was removed from `vercel.json`; once deployed the site is indexable. Unpublished city pages stay noindex via their own meta tag.
- [ ] Web Analytics: enabled on the project via the API (cookieless, no consent banner needed). Check Project > Analytics shows data after the first production visits. Speed Insights is not used.

## 2. Google Search Console
- [ ] Add property `https://rayvalue.com` (URL-prefix) or Domain property.
- [ ] Verify: either set `PUBLIC_GSC_VERIFICATION` (the token from the HTML-tag method) in Vercel and redeploy, or add the DNS TXT record at GoDaddy.
- [ ] Submit sitemap: `https://rayvalue.com/sitemap-index.xml`.

## 3. Supabase (project qefnwgdqnkzzdcpwfmkt)
- [ ] All calculator values are edited in the Table Editor (utilities, cost_ranges, model_assumptions, cities, pvwatts_city_production, offers). Changes show on the site within about 5 minutes, no redeploy.
- [ ] Every fact row needs `source_url`, `verified_on`, `verification`; assumptions need `rationale`.
- [ ] Rotate the DB password and the secret key (Project Settings > Database / API keys) now that build work is finished; update your local `.dev.vars` only. The publishable key in Vercel needs no change unless you rotate it too.
- [ ] Signups: table `rate_alert_subscribers`; read it in the dashboard only (the public key can insert but never read).

## 4. Verifying data (TODO-VERIFY workflow)
1. `npm run todo:verify` regenerates `docs/TODO-VERIFY.md` from the `todo_verify` view (null facts, agent-sourced values, assumptions, weak city mappings). You can also query the view in Supabase.
2. Check each item against its `source_url`, correct the row, and set `verification` to `human_verified`.
3. Repeat until nothing important remains; null values make the calculator show "being verified" rather than guess.
4. `npm run db:check` validates the live DB against the app's schemas (also runs in CI when Supabase secrets exist).

## 5. Publishing cities
- Each city has `cities.published` (default false). Review the page, then set `published = true` in the Table Editor. It becomes indexable and appears in the sitemap after the next deploy (sitemap is generated at build; trigger a redeploy from Vercel after flipping).
- Every city needs at least 3 unique data-driven sections before publishing.

## 6. Affiliate offers
- Table `offers`: one row per state. Set `url`, `cta_text`, `partner_name`, then `active = true`. Pages with affiliate links show the disclosure above the first link automatically. Links use `rel="sponsored noopener"`.

## 7. CI
- GitHub Actions (`.github/workflows/ci.yml`) runs `npm run check`, `npm test`, `npm run build` on every push/PR. A second job runs `npm run db:check` only if repo secrets `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` exist (Settings > Secrets and variables > Actions); otherwise it skips.

## Security headers
- CSP (Astro, `security.csp` in `astro.config.mjs`): hashed `script-src` / `style-src` (no `'unsafe-inline'`) plus `connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`. The Vercel adapter runs with `staticHeaders: true`, so Astro sends this as an HTTP header for prerendered pages (via `.vercel/output/config.json` routes) and on-demand pages (from the function). There is no `<meta>` CSP any more (a meta CSP cannot carry `frame-ancestors`).
- `vercel.json` adds, for every path: a baseline CSP without script/style hashes (`connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`; covers paths Astro does not, such as unknown-URL 404s and assets), `X-Frame-Options: DENY`, nosniff, strict-origin-when-cross-origin, minimal Permissions-Policy, HSTS (1 year, no preload/includeSubDomains), immutable cache for `/_astro/*`.
- Analytics strips query strings (`beforeSend`, `src/lib/analytics.ts`): shared calculator links contain the ZIP code and bill.
- `robots.txt` disallows `/api/`.

- Vercel Web Analytics loads from the same origin (`/_vercel/insights/script.js`), so no external origins are allowed anywhere.
- JSON-LD blocks are data, not executed. The subscribe form posts to the same origin.
- Do not add Shiki code highlighting (inline styles conflict with the CSP).

## Abuse limits (Vercel Firewall)
- Published (2026-10-22, via `vercel firewall rules add` + `publish`): custom rule **"Rate limit API"**: path starts with `/api/`, 30 requests per 60 s per IP, fixed window, action rate_limit (HTTP 429). It covers `/api/pvwatts` and `/api/subscribe`.
- A stricter separate rule for `/api/subscribe` (5 per minute per IP) was refused on the Hobby plan ("Rate limiting is not available for this plan"; Hobby allows one rate-limit rule). On Pro, add it: `vercel firewall rules add "Rate limit subscribe" --condition '{"type":"path","op":"eq","value":"/api/subscribe"}' --action rate_limit --rate-limit-requests 5 --rate-limit-window 60 --rate-limit-keys ip --yes` then `vercel firewall publish --yes` (or Project > Firewall > Add rule in the dashboard).
- `/api/pvwatts` also only accepts the `losses` values configured in `model_assumptions.pvwatts_system_loss_pct` and coordinates inside FL/CA, and redirects to one canonical URL per point, so its CDN cache absorbs repeats.

## Pre-launch checks
Measured 2026-10-22 on integrated `build/v1`, mobile Lighthouse (Moto G emulation, simulated throttling).
On-demand pages (calculator, city, methodology) were measured against the protected preview deployment
https://rayvalue-h08qtvmq2-vedanshs-projects-5b6aa829.vercel.app (live DB + live PVWatts; preview-only
vercel.live toolbar blocked). Prerendered pages were measured with `npm run lighthouse` (Vercel build output).
Preview SEO scores are not meaningful (Vercel adds `X-Robots-Tag: noindex` and auth-gates robots.txt on previews).

| Page (template) | Performance | Accessibility | Best practices | Notes |
|---|---|---|---|---|
| / (home) | 100 | 100 | 100 | preview and local both 100/100 |
| /calculator/florida (calculator) | 100 | 100 | 100 | preview; LCP ~1.0 s, CLS 0 |
| /calculator/california (calculator) | 100 | 100 | 100 | preview; CLS 0.022 |
| /solar/florida/miami (city) | 98 | 100 | 100 | preview; unpublished (noindex) |
| /guides (guide index) | 100 | 100 | 100 | |
| /guides/florida-solar-without-federal-tax-credit (guide) | 98 / 100 | 100 | 100 | preview / local |
| /alerts/thanks | 100 | 100 | 100 | noindex, not in sitemap |
| /methodology | 100 | 100 | 100 | preview (on demand) |
| /about (static content) | 100 | 100 | 100 | |
| /404 | 100 | 100 | n/a | local (Lighthouse cannot audit a 404 response on the preview) |

| Check | Result |
|---|---|
| `npm run check` | 0 errors |
| `npm test` | 227 passed, 1 skipped (live-DB integration test, opt-in) |
| `npm run build` | passes, also with an empty environment (no DB secrets) |
| `npm run db:check` | passes |
| Secrets in built output | none: no value from `.env.local` (NREL key, Supabase URL/key) appears in `.vercel/output` or `dist` |
| CSP | headless Chrome on the preview: no CSP violations or console errors on any template; FL (33101, FPL, $200, no battery, no shade) and CA (94103, PG&E, $250, 1 battery, some shade) calculator runs render results |
| Cookies | no `document.cookie` or `set-cookie` in `src` |

### Re-check after the final-review fixes (2026-10-22, preview https://rayvalue-ds8jourea-vedanshs-projects-5b6aa829.vercel.app)
| Check | Result |
|---|---|
| `npm test` / `npm run test:db` | 245 passed, 1 skipped / 307 passed (with live DB) |
| `npm run check`, `npm run build` (also empty env), `npm run db:check` | 0 errors / pass / pass |
| Headers | `/`, `/privacy` (static), `/calculator/florida`, `/solar/florida/miami`, `/methodology` (on demand): one CSP header with hashes + `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `connect-src 'self'`; `X-Frame-Options: DENY` |
| Visible "TODO" | none in any built page or on-demand page (only HTML comments) |
| `/api/pvwatts` | `losses=14` 200 (live, 1551.7 kWh/kW); `losses=15` and `losses=0` 400 |
| Headless Chrome | zero CSP violations / console errors on all templates; FL and CA runs give the same results as before (FL 10.7 kW, $33,300, ~$2,000/yr, payback 14 y; CA 5.3 kW, $30,500, $1,900/yr, 12.5 y); unlisted-utility panel and stale-results notice work; analytics `beforeSend` registered before the first pageview and strips the query |
| Lighthouse (mobile, preview) | /calculator/florida, /methodology, /: 100 / 100 / 100 (perf / a11y / best practices) |

## 8. Funnel events and optional ad tags
- Funnel events go to Vercel Web Analytics custom events (cookieless): `calc_start`, `calc_step`, `calc_complete`, `results_cta_click`, `quote_form_start`, `quote_submit`, `call_click`, and `phone_verified` (defined, fired once phone verification exists). Each event has an allowlist of properties (state, step, battery, shading, source, placement); names, emails, phones, ZIPs and addresses are never sent (`src/lib/events.ts`, unit tested). Check them in Project > Analytics > Events (custom events need a plan that includes them).
- **GA4 / Google Ads / Meta pixel are OFF.** Env vars: `PUBLIC_GA4_ID` (`G-...`), `PUBLIC_GOOGLE_ADS_ID` (`AW-...`), `PUBLIC_META_PIXEL_ID` (digits). With none set, nothing loads and the CSP is unchanged. Before setting any: (1) amend CLAUDE.md rule 7, (2) update the privacy policy (these set identifiers/cookies and share data with Google/Meta) and have it legally reviewed, (3) add a consent banner that blocks the tags until accepted (not built), (4) add the same third-party origins to the static CSP in `vercel.json` (`connect-src`, `img-src`; the build adds script/connect/img origins to Astro's CSP automatically, and the two policies intersect, so vercel.json would otherwise block them), (5) note the Meta pixel reports the page URL including any query string (shared calculator links carry ZIP and bill); GA4 is configured to report the URL without it.
- Conversion labels for Google Ads are not configured; add them when the account exists.

## Lead capture (Phase 2) owner checklist
- [ ] **Apply `supabase/migrations/0006_lead_capture.sql` BEFORE deploying this code** (it removes anon INSERT on `leads`; the new code writes with the service key). Not applied by the build agent. Apply with psql using the SUPABASE_DB_* values in `.dev.vars`, then deploy.
- [ ] Add `SUPABASE_SECRET_KEY` to Vercel (see above).
- [ ] **Attorney review** of: the consent template (`src/lib/leads/consent.ts`, `CONSENT_TEMPLATE`, and the generic "solar installers serving my area" wording used when no installer serves the ZIP), the email-estimate consent (`ESTIMATE_EMAIL_CONSENT_TEXT`), the renter handling, and the updated `/privacy` text. If wording changes: bump versions and add a migration replacing `leads_set_consent`.
- [ ] Add buyers: rows in `buyers` with `legal_name` (shown in the consent), `states`/`zips`, `active = true`. Until then every ZIP is "unserviced" and the generic wording is used.
- [ ] Staffed call line: set `CALL_NUMBER` and add `staffed_hours` rows (state, IANA timezone, weekdays 1-7, open/close). Hours are your decision; none were invented. Without both the call link never shows.
- [ ] SMS verification: create a Twilio Verify service; set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` and a random `LEAD_SIGNING_SECRET`. All four, or the step is skipped. Check Twilio's own US messaging registration requirements.
- [ ] Email: choose a provider (Resend adapter built: `RESEND_API_KEY`, `EMAIL_FROM` with a verified sender domain). Until set, "Email me this estimate" saves the request as `pending` and the page says it was saved; unsent rows are in `estimate_requests`. Name the provider in `/privacy`. The nurture list is only stored; no nurture emails are sent yet.
- [ ] `PUBLIC_RESPONSE_WINDOW`: set only to a response time you can honor; otherwise the thank-you page states no timing.
- [ ] Add `/api/serviced` and `/api/quote-config` traffic is covered by the existing 30/min/IP firewall rule on `/api/`; consider a stricter rule for `/api/leads/verify` (SMS cost) on a paid plan.
- [ ] **TrustedForm** (`PUBLIC_TRUSTEDFORM_ENABLED=true`): OFF by default. Its script records the visitor's session on the quote form, which conflicts with CLAUDE.md rule 7 as written. Before enabling: amend rule 7, update `/privacy`, and add `https://api.trustedform.com` to script-src/connect-src and `https://cert.trustedform.com` to connect-src/img-src in the static CSP in `vercel.json` (the Astro-generated CSP adds them automatically at build). The certificate URL is stored in `leads.trustedform_cert_url`. Jornaya is not built (it would need its own token column).
- Old `/quotes/thanks` redirects (301) to `/quotes/thank-you`.
