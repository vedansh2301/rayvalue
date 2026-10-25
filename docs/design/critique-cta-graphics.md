# CTA graphics plan (design critique, 2026-10-25)

Owner feedback: the lead-capture CTAs are "too text heavy, need graphics". Critique of the live site (rayvalue.com, build before commits e40a8a9..eaf2b6c). Constraints: hashed CSP (no `style=` attributes, no inline scripts — inline SVG with presentation attributes like `fill`/`stroke` is fine), Lighthouse ≥ 95, CLAUDE.md rule 4 (any chart math lives in src/lib with tests; components only render), no invented numbers in graphics.

## Priority 1 — Results: show the payoff, then bridge to quotes
- **25-year cumulative savings chart** under the Payback/Net-savings hero cards: inline SVG line/area chart — cumulative savings (likely, with low–high band) vs. upfront cost line (likely); mark the crossing point "Pays back ~year 14". Series come from the existing year-by-year cash flow in src/lib/calc/payback.ts (expose it as a pure function; scale/paths computed in src/lib, tested). Accessible: `role="img"` + `<title>`/`<desc>` + visually hidden table.
- **Visual quote bridge** at the top of the quote card: estimate chip ("14 yrs · $37,200 over 25 yrs") → arrow → 3 generic installer badges (icon tiles, no logos/brands) → "Compare up to 3 real quotes".
- **2-step quote form** (if the 3-step form already exists, apply the visuals to it): each step fits one phone screen; homeowner + timeline as **icon tiles** (home / key; bolt = ASAP, calendar = 1–3 mo, calendar+ = 3–6 mo, magnifier = researching). Consent stays verbatim (legal), `text-xs leading-6 max-w-[60ch]` below the button.

## Priority 2 — Illustrated hero + two-column /quotes
- **Home hero**: right-column inline SVG illustration (house with rooftop panels, sun, a small "savings" card graphic with no specific numbers) filling the empty 40%; trim the hero paragraph to one sentence. Mobile: illustration below the buttons, max-height ~180px, or hidden < 380px.
- **/quotes**: desktop two columns — left value panel: illustration + 3-step "How quotes work" strip (1 Tell us about your home → 2 Up to 3 local installers reach out → 3 Compare and choose — icons) + trust row; right: the form. Mobile: value panel condensed above the form (icons + 3 short lines).

## Priority 3 — One icon system
- 24px, 1.75 stroke, rounded caps, two-tone (stone-900 stroke + sun-400 accent fill), all `aria-hidden`, defined once as Astro/Preact components (`src/components/icons/*`).
- Use on: trust row (shield = no obligation, users = up to 3 installers, lock = shared only with installers you choose), "How it works" steps on home, state cards (simple FL / CA outline glyphs + two one-line facts each: FL "Net metering · tiered rates", CA "NEM 3.0 · batteries matter"), timeline tiles, city-page quote CTA.

## Accessibility / perf
- All graphics decorative unless they carry data (the chart); meaning always also in text.
- Inline SVG only (no external image requests for icons); hero illustration < 8 KB; no layout shift (fixed aspect-ratio boxes).
- Touch targets ≥ 44px on tiles.

## Acceptance
- Results page at 390×844: chart + quote bridge visible within ~1.5 screens of the results H2.
- Zero CSP/console errors; Lighthouse ≥ 95 perf/a11y on /, /quotes, /calculator/florida.
- Chart series/scaling covered by unit tests; values identical to the existing calc output.
