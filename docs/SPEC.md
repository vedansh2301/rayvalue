# RayValue build spec

## Phase 1 — Foundation
- Astro + TS + Tailwind scaffold with Cloudflare adapter
- Layout: header (logo "RayValue", tagline "Solar math for your home"),
  footer links: About, Methodology, Affiliate Disclosure, Privacy, Terms, Contact
- Pages: /, /about, /methodology, /affiliate-disclosure, /privacy, /terms,
  /contact (placeholder text marked TODO for me to write)
- Design: clean, trustworthy; warm sun-yellow accent on neutrals; system fonts
Done when: builds, preview deploys, Lighthouse ≥ 95

## Phase 2 — Data layer
- src/data/utilities.json: FPL, Duke Energy Florida, TECO (FL); PG&E, SCE,
  SDG&E (CA). Fields: id, name, state, rate tiers or TOU summary,
  fixed_monthly_charge, metering_type ("retail_net_metering" | "nem3_net_billing"),
  avg_export_credit_per_kwh (CA), source_url, verified_on
- src/data/costs.json: installed $/W (low/likely/high) per state, battery
  installed cost (low/likely/high), default annual rate escalation
- src/data/cities.json: ~10 cities per state (slug, name, state, lat, lon,
  default_utility_id)
- ZIP → lat/lon from the US Census ZCTA gazetteer file (FL + CA only)
- Zod schemas validate all data at build time; invalid data fails the build
- docs/TODO-VERIFY.md lists every null value
Users pick their utility from a dropdown filtered by state (don't guess from ZIP).

## Phase 3 — Calculator engine (pure TS + tests)
Inputs: zip, utility_id, avg_monthly_bill, battery (none / 1 / 2), shading
(none / some / heavy)
1. Estimate annual kWh from bill (subtract fixed charge, apply tiers)
2. kWh per kW-year from PVWatts (shading → system losses)
3. Size system to offset ~90–100% of usage, with a sensible cap
4. Cost range = kW × $/W range (+ battery cost)
5. Year-1 savings:
   - FL (retail net metering): offset kWh × retail rate, respecting tiers
   - CA (NEM 3.0): self-consumed share × retail rate + exported share ×
     avg export credit; self-consumption share configurable for
     solar-only vs solar + battery
6. Payback years and 25-year net savings with escalation, no federal credit
Outputs: low/likely/high for size, cost, savings, payback + assumptions list
Tests: hand-calculated fixtures per utility; edge cases (tiny bill, huge
bill, invalid ZIP, missing data)

## Phase 4 — PVWatts proxy
- functions/api/pvwatts.ts: validate lat/lon, call PVWatts v8 with
  NREL_API_KEY, cache by rounded lat/lon, return annual + monthly kWh per kW
- Precompute all cities at build time as a fallback if the API fails

## Phase 5 — Calculator UI + results
- /calculator/florida and /calculator/california: 4-step form, results card
  with ranges, "How we calculated this" section linking to /methodology
- CTA component driven by src/data/offers.json (affiliate URL per state),
  disclosure shown above it
- "Rate change alerts" email signup (provider embed, TODO)
- Shareable results via URL parameters (no personal data)

## Phase 6 — City pages (gated)
- /solar/[state]/[city] from cities.json + an MDX intro I write by hand
- Unique sections: local utility rate table, monthly production chart for
  that city, example payback for 3 bill sizes, local notes
- Unpublished pages = noindex and excluded from sitemap

## Phase 7 — Guides + technical SEO
- /guides content collection (MDX) with frontmatter: title, description,
  updated, sources[]
- Sitemap, robots.txt, canonical URLs, Open Graph images, breadcrumbs
- JSON-LD: Organization, BreadcrumbList, Article, WebApplication (calculators)
- Every guide links to its state calculator

## Phase 8 — Launch
- GitHub → Cloudflare Pages; NREL_API_KEY as environment variable
- Connect rayvalue.com, HTTPS, custom 404 page
- Cloudflare Web Analytics; Google Search Console verification + sitemap
