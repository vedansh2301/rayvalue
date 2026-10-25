# RayValue

rayvalue.com: solar and battery payback calculators for Florida and California homeowners, built for the post-federal-tax-credit market. Static Astro site; the calculator is a single Preact island; hosted on Vercel; API endpoints are Astro server routes in `src/pages/api/` (Vercel Functions), their logic in `src/lib/server/`. Project rules are in `CLAUDE.md`, the build spec in `docs/SPEC.md`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Astro dev server |
| `npm run build` | Static build to `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm test` / `npm run test:watch` | Vitest |
| `npm run check` | `astro check` (types) |
| `npm run test:db` | Vitest including the live-database integration test (loads `.env.local`; skipped by plain `npm test`) |
| `npm run db:check` | Validates every calculator table in the live database with the site's Zod schemas (publishable key from `.env.local`); exits 1 on invalid data. Run after editing values and before deploying |
| `npm run todo:verify` | Regenerates `docs/TODO-VERIFY.md` from the database view `todo_verify` (admin: needs `SUPABASE_SECRET_KEY` from `.dev.vars`) |
| `npm run data:pvwatts` | Fills `pvwatts_city_production` from PVWatts v8 for every city x losses value (admin: needs `SUPABASE_SECRET_KEY`, and `NREL_API_KEY` else the rate-limited `DEMO_KEY`; resumable, `-- --refresh` refetches all; the build never calls the API) |
| `npm run lighthouse` | Lighthouse against `astro preview` (run `npm run build` first); fails if performance or accessibility is under 95. Optional paths: `npm run lighthouse -- /about` |

## Environment variables

- Client-visible, build time (see `.env.example`): `PUBLIC_CF_BEACON_TOKEN`, `PUBLIC_GSC_VERIFICATION`.
- Server-only, set in Vercel for all environments: `NREL_API_KEY` (PVWatts proxy; `/api/pvwatts` returns 503 until set), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`. Local dev: `vercel env pull .env.local` (gitignored), then `npm run dev` serves the API routes and DB-backed pages. Site code never reads `SUPABASE_SECRET_KEY` or `SUPABASE_DB_*`; only the admin scripts (`todo:verify`, `data:pvwatts`) read `SUPABASE_SECRET_KEY` from the owner's local `.dev.vars`.

## API routes

- `GET /api/pvwatts?lat=&lon=&losses=`: PVWatts v8 proxy (NREL is now NLR: `developer.nlr.gov`). lat/lon must be in FL or CA; `losses` a whole percent from 0 to 60 (the calculator sends the `pvwatts_system_loss_pct` values; the endpoint does not read the database). Unrounded URLs get a 308 to the 2-decimal canonical URL; responses are cached 30 days on Vercel's CDN (`CDN-Cache-Control`). When it is unavailable the calculator falls back to the precomputed `pvwatts_city_production` rows passed in as page props.
- `POST /api/subscribe`: rate-alert signup (JSON or form). Same-origin only.
- `POST /api/leads`: installer-quote request from the quote form (JSON or form; plain form posts get 303 -> `/quotes/thanks`). `POST /api/data-requests`: privacy request from `/privacy/request` (303 -> `/privacy/request/thanks`). Same-origin only, 8 KB body cap, honeypot field `website`, 8 s database timeout; logic in `src/lib/server/leads.ts`, validation in `src/lib/leads/`.

## Supabase (email alerts)

Project `qefnwgdqnkzzdcpwfmkt`, table `public.rate_alert_subscribers` (schema in `supabase/migrations/0001_rate_alert_subscribers.sql`, already applied). Row Level Security is on; the `anon` role (publishable key) has column-level INSERT on `email, state, source` and nothing else, so a leaked publishable key can add a signup but never read the list. A duplicate email returns 409 (unique violation), which the endpoint treats as success. To view signups: Supabase dashboard, Table Editor (or SQL editor) as the project owner.

## Where leads live

Quote requests are stored only in Supabase, table `public.leads`; privacy requests (delete / access / correct / do-not-sell) in `public.data_requests` (schema: `supabase/migrations/0004_leads.sql` and `0005_leads_consent_trigger.sql`, applied). As with the alert signups, `anon` (the publishable key) has column-level INSERT on the user-supplied columns only, and no SELECT, UPDATE or DELETE, so the site can add a lead but a leaked key can never read them. Each lead stores the consent sentence, version and time, set by a database trigger (`supabase/migrations/0005_leads_consent_trigger.sql`; anon cannot write those columns) with the same constants as `src/lib/leads/consent.ts` (a unit test compares them; when the text changes, bump the version there and add a migration replacing the trigger function), and the estimate they saw (`estimate_snapshot`) when it came from calculator results. To work leads: Supabase dashboard, Table Editor, `leads`; move `status` through `new` / `contacted` / `sold` / `invalid` / `deleted`. Handle `data_requests` the same way (`status` `new` / `in_progress` / `done` / `rejected`).

## Data

Every rate, cost, assumption, city and precomputed production value lives in Supabase (project `qefnwgdqnkzzdcpwfmkt`, schema in `supabase/migrations/0002_calculator_data.sql`). The repo holds only schemas (`src/data/schemas.ts`, Zod), the read layer (`src/lib/db/`), pure calculator math (`src/lib/calc/`) and the Census ZIP -> lat/lon reference table (`src/data/zips/`, generated by `npm run build:zips`). Pages that show values are rendered on demand (`prerender = false`) and cached on Vercel's CDN for 5 minutes. Unknown values are `null` and listed in `docs/TODO-VERIFY.md`.

## Editing calculator values

Edit rows in the Supabase dashboard, **Table Editor** (signed in as the project owner). No code change or redeploy is needed: the site reads the database at request time and Vercel's CDN caches pages for 5 minutes (`s-maxage=300`), so a change is live within about 5 minutes (the stale copy may be served once more while it refreshes).

| Table | Holds |
| --- | --- |
| `utilities` | One row per utility rate plan: fixed charge, minimum bill (amount + basis), CA baseline and export credits, notes, the published CA class-average rate (`avg_rate_*` columns, with their own `avg_rate_source_url` / `avg_rate_verified_on` / `avg_rate_verification`), provenance, `source_caveat`, `display_order` |
| `utility_tier_sets` / `utility_tiers` | Tiered (FL) plans: one tier set per season with its `months`, and its tiers in `position` order (0 = first; the last tier's `up_to_kwh` is empty). Provenance is the parent `utilities` row |
| `utility_tou_rates` | Time-of-use (CA) rates per season / period / day type. Provenance is the parent `utilities` row |
| `cost_ranges` | Installed cost per watt and battery cost per state: low / likely / high + unit, note, provenance |
| `model_assumptions` | Product choices (losses per shading level, offset, size limits, degradation, escalation, CA self-consumption, missing-range spread, max bill): `value` is a JSON object, `rationale` explains it. `state` empty = both states; a row with `state` FL or CA overrides it for that state |
| `cities` | City pages and the ZIP -> nearest city mapping: coordinates, default utility and how well that is sourced (`utility_confidence`), `published` (false = noindex, not in sitemap), `local_notes`, `intro_md` |
| `pvwatts_city_production` | PVWatts output for 1 kW DC per city and losses value (written by `npm run data:pvwatts`) |
| `offers` | Partner offer per state shown with results (only `active` rows with a `url`) |

Provenance rules (the database rejects rows that break the first two; the site's Zod validation enforces all of them):

- A fact row holding any number needs `source_url` (the exact page read), `verified_on` (date read) and `verification` other than `unverified`. A row with no numbers is `unverified` with no source or date.
- `low <= likely <= high` wherever a range has values.
- `verification` is `agent_sourced` (read by an agent, needs your confirmation) or `human_verified` (only you set this).
- Never fill a value you have not read from a source: leave it empty (null). Assumptions need a `rationale` instead of a source.
- If a source is old, undated or inconsistent, say so in `source_caveat`.

After editing:

1. `npm run db:check` validates every table the way the site does. If a row is invalid the site does not guess: the calculator reports the value as missing and pages show "being verified", so fix whatever `db:check` reports.
2. `npm run todo:verify` regenerates `docs/TODO-VERIFY.md` (empty values, agent-sourced values to confirm, assumptions, weak city mappings, stale sources); commit it. The same list is the `todo_verify` view in the SQL editor: `select * from todo_verify order by section, sort_key;`.

## Placeholder copy

Text the owner must write is marked `OWNER:` (pages) or `TODO:` (draft guides/blog), and `{{PLACEHOLDER}}` fields on /about. Find it with `grep -rE "OWNER:|TODO:|\{\{[A-Z_]+\}\}" src`.
