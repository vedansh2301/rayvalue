# RayValue

rayvalue.com: solar and battery payback calculators for Florida and California homeowners, built for the post-federal-tax-credit market. Static Astro site; the calculator is a single Preact island; API endpoints are Cloudflare Pages Functions in `functions/`. Project rules are in `CLAUDE.md`, the build spec in `docs/SPEC.md`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Astro dev server |
| `npm run build` | Static build to `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm test` / `npm run test:watch` | Vitest |
| `npm run check` | `astro check` (types) |
| `npm run preview:cf` | Build, then `wrangler pages dev dist` (includes Functions) |
| `npm run lighthouse` | Lighthouse against `astro preview` (run `npm run build` first); fails if performance or accessibility is under 95. Optional paths: `npm run lighthouse -- /about` |

## Environment variables

- `.env` (see `.env.example`): `PUBLIC_CF_BEACON_TOKEN` (Cloudflare Web Analytics beacon, omitted when unset), `PUBLIC_GSC_VERIFICATION` (Search Console meta tag).
- `.dev.vars` (see `.dev.vars.example`, Functions only, never in client code): `NREL_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Data

Every rate, cost and statistic lives in `src/data/*.json` with `source_url` and `verified_on`. Unknown values are `null` and listed in `docs/TODO-VERIFY.md`. Calculator math is pure functions in `src/lib/calc/`.

## Placeholder copy

Text the owner must write is marked `TODO:`. Find it with `grep -r "TODO:" src`.
