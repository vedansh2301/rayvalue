# Handoff Spec: RayValue v1.1 — results card, page grid, mobile nav, polish

Source: design critique of the live site (2026-10-22). Stack: Astro 7 + Tailwind v4 + Preact island (`src/components/calculator/Calculator.tsx`). Tokens live in `src/styles/global.css` (`@theme`). CSP is hashed: **no inline `style=` attributes, no inline scripts** — classes only. Rule 4 (CLAUDE.md): UI never does math — reordering/labels only; values come from `calculate()` + `display.ts`.

## Overview

Homeowners land on a calculator to answer one question: *does solar pay off for me?* v1.1 makes the results answer that first, gets users to the results faster (especially on mobile), lines up every page on one grid, and fixes the wrapped mobile nav. No new data, no new calculations.

Scope (6 changes):
1. Results card: lead with payback + net savings; slim tax-credit note.
2. Form collapses to an editable summary after a successful run.
3. One page grid shared by content and footer; header stays full-bleed.
4. Mobile header nav: one row, short labels, 44px targets.
5. City page: chart value labels, amber primary CTA, neutral breadcrumbs.
6. Home hero CTAs; helper-text contrast; footer link targets.

## Layout

### Page grid
| Token | Value | Usage |
|---|---|---|
| `--spacing-gutter` | 1rem (base) · 1.5rem (≥640px) · 2.5rem (≥1024px) | Left/right padding of header, footer and page shell. **Must match the header** (`px-4 sm:px-6 lg:px-10`). |
| `--container-shell` | 75rem (1200px) | Max width of page content and footer inner. |
| `--container-prose` | 48rem (768px) | Max width of reading/calculator column (current `.page` width). |

- **Header:** stays full-bleed (owner decision: logo hugs left edge, nav hugs right edge at any zoom). Inner padding = gutter.
- **Shell:** new utility `.shell { width:100%; max-width: var(--container-shell); margin-inline:auto; padding-inline: var(--spacing-gutter) }`.
- **Content alignment:** `.page` becomes `shell` + inner column `max-w-[--container-prose]` **left-aligned inside the shell** (not centered), so the H1's left edge lines up with the logo at every viewport ≤ 1280px (shell + 2×gutter). Above 1280px the shell centers; header remains edge-to-edge — accepted, and standard.
- **Footer:** inner wrapper uses `shell` (replace `max-w-5xl px-4`), so footer links start on the same x as page content.
- **Home:** hero, "Choose your state" and "How it works" use `shell`; text blocks keep `max-w-[--container-prose]`, card grids may use the full shell width.

Why: today the logo (40px), home headline (~144px), calculator H1 (~272px) and footer (~144px) all start at different x-positions; one left edge reads as one product.

### Breakpoints (Tailwind defaults)
`sm` 640px · `md` 768px · `lg` 1024px. Mobile = <640px.

## Design Tokens Used
| Token | Value | Usage |
|---|---|---|
| `--color-sun-400` | #fbbf24 | Primary button fill, step-progress active, "likely" accent bar |
| `--color-sun-500` | #f59e0b | Primary button hover, chart bars, selected radio border |
| `--color-sun-50` | #fffbeb | Selected radio bg, callouts |
| `--color-sun-ink` | #92400e | Accent text on light bg ("likely" tag, prose links) — 7:1 on white |
| `stone-900` | #1c1917 | Headings, big numbers, primary button text |
| `stone-700` | #44403c | Body text |
| `stone-600` | #57534e | **Minimum** for any text ≤ 14px (replaces stone-500 helper text) |
| `stone-200` | #e7e5e4 | Card borders, dividers |
| `stone-50` | #fafaf9 | Page bg, metric card bg |
| `font-sans` | system stack | All text |
| `text-4xl/700` | 36px bold, tracking-tight | Hero metric value (new) |
| `text-2xl/700` | 24px bold | Standard metric value (existing) |
| `text-sm/500` | 14px medium | Metric label |
| `rounded-2xl` / `rounded-xl` | 16px / 12px | Results card / metric cards |
| Spacing | Tailwind scale: `gap-3` (12px) between metrics, `mt-6` (24px) between result blocks | |

Button classes (reuse existing constants in Calculator.tsx; add `btnPrimary` export to a shared `src/components/ui/buttons.ts` so Astro pages use the same string):
- **Primary:** `inline-flex min-h-11 items-center gap-2 rounded-lg bg-sun-400 px-5 font-semibold text-stone-900 hover:bg-sun-500 focus-visible:outline-2 disabled:opacity-60`
- **Secondary:** existing `btnSecondary` (white, stone-300 border).
- **Text link button:** `min-h-11 px-2 font-medium text-sun-ink underline underline-offset-4 hover:text-stone-900`.

## Components

| Component | Variant | Props | Notes |
|---|---|---|---|
| `Metric` | `hero` (new) | `label, d: RangeDisplay, note?` | Value `text-4xl font-bold`; card `bg-white border-2 border-sun-300 p-5`. Used for Payback + Net savings only. |
| `Metric` | `standard` (existing) | same | Unchanged styling. Upfront cost, First-year savings. |
| `Metric` | `compact` (new) | same | One line: label left, `likely (low–high)` right, `text-base`. System size. |
| `TaxNote` (new, inline in Results) | — | — | `mt-2 text-sm text-stone-700` single line with a 16px info icon (inline SVG, `aria-hidden`). Text unchanged. Replaces the yellow banner. |
| `InputSummary` (new) | — | `zip, utilityName, bill, battery, shading, onEdit(step)` | Collapsed form after success. See States. |
| `Header` nav | mobile / desktop | — | Short labels on mobile (see Responsive). |
| `ProductionChart` | with labels | existing | Value label above each bar. |
| `Breadcrumbs` | neutral (single style) | `items` | Links `text-stone-700 underline underline-offset-4 hover:text-stone-900`; current item `text-stone-900 font-medium` + `aria-current="page"`. Remove amber link styling on city pages. |
| City CTA | primary | — | Use `btnPrimary` (amber). Remove black/underlined variant. |

### Results order (desktop ≥640px, 2-col grid `grid gap-3 sm:grid-cols-2`)
1. Row 1 (hero): **Payback** · **Net savings over {analysisYears} years**
2. Row 2 (standard): **Upfront cost** (note "Before any incentives") · **First-year bill savings**
3. Row 3 (compact, `sm:col-span-2`): **System size**
Then `<details>` assumptions, then actions. Mobile: same order, single column.

Content above the grid, in order: H2 "Your solar estimate" → "For a home on {utility}." → TaxNote → fallback-city note (if any) → "Worth knowing" warnings (if any) → grid.

## States and Interactions

| Element | State | Behavior |
|---|---|---|
| Primary button | Default / Hover / Focus / Disabled | sun-400 / sun-500 / 2px stone-900 outline offset 2 / 60% opacity, `cursor-not-allowed`, no hover change |
| Primary button | Busy (submit) | Label → "Calculating…", disabled; existing `aria-live` "Calculating your estimate…" stays |
| Form | Before first success | As today (4 steps). |
| Form | After **successful** result (`outcome.kind==='result' && ok`) | Collapses to `InputSummary`; step UI unmounted. Focus moves to results H2 (existing). |
| `InputSummary` | Default | Card `rounded-2xl border border-stone-200 bg-white p-4 sm:p-5`. Row: "Your answers" (`text-sm font-medium text-stone-700`), then chips/inline text: `33101 · Florida Power & Light (FPL) · $200/mo · No battery · Little or no shade`, then text-link button **Edit answers** (right-aligned ≥640px, below on mobile). |
| `InputSummary` | Edit clicked | Re-expand the full form at **step 4** (most-edited), previous values kept; focus the step heading; results stay visible below and get the existing `stale` notice once any input changes. |
| `InputSummary` | Results not ok (missing_data / error / no_production) | Do **not** collapse — user likely needs to change inputs. |
| Start over | Click | As today (reset + step 1), plus re-expand form. Style: text-link button (de-emphasized). |
| Copy link | Click | As today; status text "Link copied." in `role="status"`. Stays secondary button. |
| Stale notice | Inputs changed after results | Unchanged (amber box at top of results). |
| Header nav link | Hover / current page | underline / `aria-current="page"` + `text-stone-900 font-semibold` (add current-page detection by `Astro.url.pathname` prefix). |
| Chart bar | Default | No hover interaction (static SVG). |

## Responsive Behavior

| Breakpoint | Changes |
|---|---|
| Desktop (≥1024px) | Header gutter 40px; content shell max 1200px; results grid 2-col; hero metrics side by side. |
| Tablet (640–1023px) | Gutter 24px; results grid 2-col; header single row (logo left, nav right). |
| Mobile (<640px) | Gutter 16px. **Header:** logo row, then nav on its own single row, `flex-nowrap overflow-x-auto` (scrollbar hidden via utility, scroll-snap optional), labels shortened: "Florida", "California", "Guides", "Blog" (link names still contain the visible text — WCAG 2.5.3 OK; add `title` with full name). Each link `inline-flex min-h-11 items-center px-2`. Results single column; hero metrics first so the answer is in the first screen after the summary. InputSummary stacks: text then Edit link. |

## Edge Cases
- **Payback null** (`>25 yrs`): hero Payback shows "More than {analysisYears} years" via `displayPayback` (existing); no "likely" tag.
- **Negative net savings:** `formatSignedUsd` already prefixes "−"; keep `text-stone-900` (no red — avoid alarm styling for an honest estimate); note "Bill savings minus upfront cost" stays.
- **Single values (low==high):** `displayRange` → `single`; hero/standard show value without range line.
- **No usage (`annualUsageKwh === 0`):** grid hidden (existing); InputSummary still shown with Edit.
- **missing_data / no_production / error:** no grid, form stays expanded (see States).
- **Fallback city:** note under TaxNote, unchanged copy.
- **Long utility names** (e.g. "San Diego Gas & Electric (SDG&E)"): InputSummary wraps naturally; never truncate utility names (users verify against their bill).
- **Battery + CA:** no layout change.
- **Slow network:** busy state as today; PVWatts 6s timeout → fallback note (existing).
- **City chart labels:** integer kWh (`formatKwh` or `Math.round` **in `chartBars()` in src/lib/city**, not in the component — rule 4); `text-[11px] fill-stone-700`, placed 4px above bar; if bar height < 16px, label still above. Keep the sr-only data table.

## Animation / Motion
| Element | Trigger | Animation | Duration | Easing |
|---|---|---|---|---|
| Form → InputSummary | Successful result | none (instant swap); focus jump only | — | — |
| Results card | First appearance | opacity 0→1 | 150ms | ease-out |
| Smooth scroll to results | Focus move | existing `scroll-behavior: smooth` | browser | — |
All motion disabled under `prefers-reduced-motion: reduce` (`motion-safe:` prefix).

## Home page
- Hero: add two primary buttons under the sub-copy, `mt-6 flex flex-wrap gap-3`: "Florida calculator →", "California calculator →" (equal weight — neither state is primary). Keep "Free, no sign-up, and no phone calls." below them as `text-sm text-stone-600`.
- Reduce hero bottom padding by half (currently ~120px empty band before "Choose your state").
- State cards stay (second entry point + context).

## Accessibility Notes
- **Focus order (results view):** InputSummary "Edit answers" → results H2 (programmatic focus target, `tabIndex=-1`) → details summary → Copy link → Start over → page content.
- **Headings:** H2 "Your solar estimate"; InputSummary is not a heading (`<section aria-label="Your answers">`).
- **Metrics:** keep `<dl>` / `<dt>` / `<dd>` and the sr-only "Likely " prefix; hero variant is visual only.
- **Nav:** `<nav aria-label="Main">` unchanged; current page `aria-current="page"`; horizontally scrollable list must remain keyboard reachable (links are focusable; ensure focused link scrolls into view — native behavior).
- **Contrast:** any text ≤14px uses ≥ stone-600 (7.4:1 on stone-50). Chart labels stone-700 on stone-50 (9:1).
- **Touch targets:** all nav/footer links and text-link buttons ≥ 44px tall (`min-h-11`).
- **Screen reader announcements:** unchanged (`aria-live` busy text, `role="status"` copy result, `role="alert"` field errors).

## Acceptance checklist
- [ ] At 1280px the logo, page H1 and first footer link share the same left x (±1px).
- [ ] At 390px the header nav is one row, no wrap, no page-level horizontal scroll.
- [ ] After a successful FL run (33101 / FPL / $200 / no battery / no shade) on 390×844, the Payback value is visible within one screen-height of the results H2.
- [ ] Results values identical to before (pure reorder) — existing calc/display tests pass; add tests for `chartBars` labels.
- [ ] No `style=` attributes; zero CSP console errors (headless check); Lighthouse ≥ 95 perf/a11y on /, /calculator/florida, /solar/florida/miami.
