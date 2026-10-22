# RayValue launch checklist (owner)

Hosting: Vercel project `rayvalue` (team vedanshs-projects-5b6aa829). Repo: github.com/vedansh2301/rayvalue (already connected; production branch `main`). Node 24 (`.nvmrc`).

## 1. Vercel
- [ ] Environment variables (Project > Settings > Environment Variables), all environments: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `NREL_API_KEY` (all set). Optional build var: `PUBLIC_GSC_VERIFICATION`.
- [ ] Never add `SUPABASE_SECRET_KEY` or `SUPABASE_DB_*` to Vercel; site code does not read them.
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

## Security headers (vercel.json)
- Header CSP: `connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` plus nosniff, strict-origin-when-cross-origin, minimal Permissions-Policy, HSTS (1 year, no preload/includeSubDomains), immutable cache for `/_astro/*`.
- `script-src` / `style-src` come from Astro's built-in hash-based CSP (`security.csp: true` in `astro.config.mjs`), emitted as a `<meta http-equiv="content-security-policy">` on every page. They are intentionally NOT in the header: two CSPs are intersected, so a header `script-src 'self'` would block the hashed inline island/analytics scripts. No `'unsafe-inline'` is used for scripts or styles.
- Vercel Web Analytics loads from the same origin (`/_vercel/insights/script.js`), so no external origins are allowed anywhere.
- JSON-LD blocks are data, not executed. The subscribe form posts to the same origin.
- Do not add Shiki code highlighting (inline styles conflict with the CSP).

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
