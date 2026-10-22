# RayValue — project rules

## What this is
rayvalue.com: solar + battery payback calculators for homeowners in Florida
and California, built for the post-federal-tax-credit market. Revenue: affiliate
links on calculator results now, direct lead sales later. Read docs/SPEC.md
before starting any phase.

## Stack
- Astro (static-first) + TypeScript + Tailwind
- Calculator UI: one interactive island; everything else static HTML
- Vercel (static + Vercel Functions for the PVWatts proxy and email signup)
- Vitest for all calculator math

## Hard rules
1. Never invent numbers. Every rate, cost, assumption, city or statistic lives in
   the Supabase DB (tables in supabase/migrations; edited there, never hardcoded
   in code) with `source_url` + `verified_on` (facts) or `rationale` (assumptions).
   If no verified value exists, use null; `npm run todo:verify` lists it in
   docs/TODO-VERIFY.md.
2. Federal 25D tax credit = $0 for 2026+ installs. Never show it as available.
3. Show results as ranges (low / likely / high), never false precision.
4. All calculator logic = pure functions in src/lib/calc/, fully unit tested.
   UI components never do math.
5. Must not look like a government site: no seals, no "official", no .gov styling.
6. Any page with affiliate links shows the disclosure component above the first link.
7. No cookies or third-party trackers except Vercel Web Analytics (cookieless).
8. Mobile-first. Lighthouse ≥ 95 for performance and accessibility on every template.
9. City pages: each needs ≥ 3 unique data-driven sections, and `published: false`
   (noindex, not in sitemap) by default until I review it.
10. API keys only in environment variables, never in client code or the repo.

## Workflow
- One phase at a time from docs/SPEC.md. Plan first, wait for my OK, then build.
- After each phase: run `npm run build` and `npm test`, fix failures,
  summarize changes, and commit with a clear message.
- If a product decision is unclear, ask me instead of guessing.
