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
| `npm run data:pvwatts` | Refresh `src/data/pvwatts-cities.json` from PVWatts v8 (needs `NREL_API_KEY`, else the rate-limited `DEMO_KEY`; resumable; the build never calls the API) |
| `npm run lighthouse` | Lighthouse against `astro preview` (run `npm run build` first); fails if performance or accessibility is under 95. Optional paths: `npm run lighthouse -- /about` |

## Environment variables

- Client-visible, build time (see `.env.example`): `PUBLIC_CF_BEACON_TOKEN`, `PUBLIC_GSC_VERIFICATION`.
- Server-only, set in Vercel for all environments: `NREL_API_KEY` (PVWatts proxy; `/api/pvwatts` returns 503 until set), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`. Local dev: `vercel env pull .env.local` (gitignored), then `npm run dev` serves the API routes. Site code never reads `SUPABASE_SECRET_KEY` or `SUPABASE_DB_*`.

## API routes

- `GET /api/pvwatts?lat=&lon=&losses=`: PVWatts v8 proxy (NREL is now NLR: `developer.nlr.gov`). lat/lon must be in FL or CA; `losses` one of the `pvwatts_system_loss_pct` values. Unrounded URLs get a 308 to the 2-decimal canonical URL; responses are cached 30 days on Vercel's CDN (`CDN-Cache-Control`). Falls back, client-side, to `src/data/pvwatts-cities.json`.
- `POST /api/subscribe`: rate-alert signup (JSON or form). Same-origin only.

## Supabase (email alerts)

Project `qefnwgdqnkzzdcpwfmkt`, table `public.rate_alert_subscribers` (schema in `supabase/migrations/0001_rate_alert_subscribers.sql`, already applied). Row Level Security is on; the `anon` role (publishable key) has column-level INSERT on `email, state, source` and nothing else, so a leaked publishable key can add a signup but never read the list. A duplicate email returns 409 (unique violation), which the endpoint treats as success. To view signups: Supabase dashboard, Table Editor (or SQL editor) as the project owner.

## Data

Every rate, cost and statistic lives in `src/data/*.json` with `source_url` and `verified_on`. Unknown values are `null` and listed in `docs/TODO-VERIFY.md`. Calculator math is pure functions in `src/lib/calc/`.

## Placeholder copy

Text the owner must write is marked `TODO:`. Find it with `grep -r "TODO:" src`.
