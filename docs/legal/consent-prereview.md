# Lead consent and privacy: compliance pre-review (for counsel)

Prepared 2026-10-25 for the owner to hand to counsel before paid traffic.

**This is not legal advice.** It was written by an AI coding assistant, not a lawyer. It lists what the code
does today, what the primary sources say, and where they may not line up. Every "risk" and "fix" below is a
prompt for counsel, not a conclusion. Nothing live was changed: the consent text, the trigger and the pages
are as they were.

## 0. Scope and facts counsel needs

- **Business model.** rayvalue.com runs solar and battery payback calculators for Florida and California
  homeowners. The quote form collects first and last name, email, mobile phone, street address, ZIP, state,
  homeowner status, bill bracket, utility, roof shade and age, battery interest, payment method and timeline.
  The owner sells or forwards each lead to **up to 3 installers ("buyers")** serving the ZIP. Revenue today is
  affiliate links; lead sales are next.
- **Who calls.** Installers call and text the lead. The consent also names **RayValue** as a party that may
  call and text. Today RayValue itself only sends (a) an optional SMS one-time code (Twilio Verify) and
  (b) email (estimate email, nurture series, owner notices). There is a "Talk to someone now" click-to-call
  link (inbound only) during staffed hours. No outbound RayValue calling system is in the code.
- **Where things live.**
  - Consent template and versions: `src/lib/leads/consent.ts`.
  - DB trigger that enforces the wording: `supabase/migrations/0006_lead_capture.sql` (`public.leads_set_consent`).
    It replaced the earlier trigger in `0005_leads_consent_trigger.sql` (version `2026-10-22.1`), which is
    **no longer live**. Checked against the live database on 2026-10-25 (read-only query): the live function
    holds the 0006 template and versions `2026-10-25.1` / `2026-10-25.2`. No leads are stored yet.
  - Form: `src/components/quotes/QuoteForm.tsx` (used on `/quotes` and on calculator results);
    estimate-email form: `src/components/quotes/EstimateEmailForm.tsx`.
  - Routing (who gets a lead): `src/lib/routing/eligibility.ts`, `src/lib/server/routing.ts`;
    delivery payload: `src/lib/routing/delivery.ts`.
  - Privacy page: `src/pages/privacy.astro`; request form: `src/pages/privacy/request/index.astro`;
    terms: `src/pages/terms.astro`; footer "Do Not Sell or Share" link: `src/components/Footer.astro`.

## 1. Current wording (verbatim)

### 1a. Quote-form consent, live (versions 2026-10-25.1 and 2026-10-25.2)

Template (identical in `consent.ts` and the live trigger):

> By clicking "Get my free quotes," I agree that RayValue and {{INSTALLER_NAMES}} may contact me about solar at
> the phone number and email I provided, including by calls and texts made with automated technology or
> prerecorded messages. Consent is not a condition of purchase. Message and data rates may apply. Reply STOP to
> opt out. See our Privacy Policy.

- **2026-10-25.1 (named):** `{{INSTALLER_NAMES}}` = the `legal_name` of each active buyer serving the ZIP (max 3),
  joined "A", "A and B" or "A, B, and C".
- **2026-10-25.2 (no buyer yet):** `{{INSTALLER_NAMES}}` = `solar installers serving my area`.
- "Privacy Policy" is rendered as a link to `/privacy` (top of page).

### 1b. Superseded wording (version 2026-10-22.1, migration 0005, not live)

> By submitting, you agree that RayValue and up to 3 solar installers serving your area may contact you by
> phone (including calls and texts using automated technology), text or email about solar quotes. Consent is
> not a condition of purchase. Message and data rates may apply. You can opt out at any time. See our Privacy
> Policy (/privacy).

### 1c. Estimate-email consent (version 2026-10-25.1)

> Email me this estimate. I also agree that RayValue may email me occasional updates about solar costs and
> savings. I can unsubscribe at any time. See our Privacy Policy.

### 1d. Other text on step 3 of the quote form (not stored with the lead)

- Phone field hint: "Only RayValue and the installers listed here can use it. Reply STOP at any time." (or
  "...solar installers serving your area...").
- Box: "Installers serving {ZIP}:" with a bullet list of the names.
- Under the checkbox: "Free and no obligation. We only share your details with the installers named above."
  (or "...We won't share your details until an installer serves your area.")
- Submit button label: "Get my free quotes".

### 1e. Form UX as built

- 3 steps (home, project, contact). The consent is the label of an **unchecked checkbox** on step 3, directly
  above the submit button, 14px text. Both checking the box and clicking the button are required; the form
  will not submit without the box ("Check the box to agree to be contacted about quotes.").
- Installer names are looked up from the ZIP; the server recomputes the consent from its own lookup and rejects
  the submission (HTTP 409, box unticked, new names shown) if the names changed. The DB trigger recomputes
  again and rejects any text that is not one of the two approved wordings.
- Phone verification by SMS code is **optional** and offered after submission (only when Twilio is
  configured). Unverified leads can be sold; buyers are told "(not verified)".
- Routing sends a lead only to buyers whose `legal_name` is in `consented_installers`. Leads with the generic
  2026-10-25.2 wording therefore can never be routed (no named installer). Dedupe (30 days) and Do Not
  Sell/Delete suppression run before routing.

### 1f. What is stored as consent evidence

`consent_text`, `consent_version`, `consent_at` (DB clock), `consented_installers`, `consent_ip`,
`consent_page_url`, `user_agent`, the form answers, UTM/click IDs, and optionally a TrustedForm certificate URL
(vendor **off** by default). Buyers receive text, version, timestamp, IP, page URL, installer list and
certificate URL with each lead. Not stored: a rendering/screenshot of the page as shown, the checkbox event,
the build or commit that served the form, the surrounding step-3 text in 1d.

### 1g. Privacy page (summary)

`/privacy` is a plain-language page (currently `noindex`, flagged "TODO: owner legal review"). It describes
data collected, the consent record, sale or sharing to the named installers (up to 3), unserviced and renter
handling, session-storage attribution, service providers (Vercel, Supabase, Twilio, an unnamed email
provider), a "California residents" section linking to the Do Not Sell or Share form, and a request form
(email address + request type). Retention: "We keep it until you ask us to delete it." No "last updated" date,
no CCPA category table, no retention periods, no Global Privacy Control statement.

## 2. Law in force as checked on 2026-10-25 (primary sources)

| Topic | What the source says (short) | Source |
|---|---|---|
| TCPA prior express written consent (PEWC) | Written agreement bearing the called person's signature that clearly authorizes **the seller** to deliver advertisements or telemarketing using an ATDS or artificial/prerecorded voice, **and the telephone number**; must disclose clearly and conspicuously that signing authorizes such calls and is not a condition of purchase. E-signature counts if valid under federal law or state contract law. | 47 CFR 64.1200(f)(9), [eCFR current text](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-B/part-64/subpart-L/section-64.1200) (latest version dated 2026-03-25) |
| "One-to-one" consent rule | The 11th Circuit vacated Part III.D of the FCC's 2023 order (one-to-one and "logically and topically associated") on 2025-01-24. The current eCFR text of (f)(9) contains **no** one-to-one or "logically and topically" language: the pre-2023 definition is back. Secondary sources report the FCC formally removed the vacated text in 2025 (Federal Register cite not confirmed here). | *Insurance Marketing Coalition Ltd. v. FCC*, No. 24-10277 (11th Cir. Jan. 24, 2025), [opinion](https://media.ca11.uscourts.gov/opinions/pub/files/202410277.pdf); eCFR above |
| FCC interpretations not binding on courts | District courts interpret the TCPA themselves and give FCC orders "appropriate respect" but not binding deference. | *McLaughlin Chiropractic Assocs. v. McKesson Corp.*, No. 23-1226 (U.S. June 20, 2025), [docket and opinion](https://www.supremecourt.gov/docket/docketfiles/html/public/23-1226.html) |
| E-SIGN and web-form consent | FCC: consent obtained in compliance with E-SIGN, "including permission obtained via an email, website form, text message, telephone keypress, or voice recording", satisfies PEWC. | FCC 12-21 (2012 TCPA Order), [PDF](https://docs.fcc.gov/public/attachments/FCC-12-21A1.pdf); 15 U.S.C. 7001 et seq. |
| Revocation | Any reasonable method revokes; "stop, quit, end, revoke, opt out, cancel, unsubscribe" by text are per se valid; honor within **10 business days**; caller may not designate an exclusive revocation method; one confirmation text allowed (presumed OK within 5 minutes). The "revoke-all" part of (a)(10) is delayed to **2027-01-31** (Jan 2026 bureau order, per secondary sources). | 47 CFR 64.1200(a)(10)–(12), eCFR above |
| Calling hours (federal) | No telephone solicitation before 8 a.m. or after 9 p.m. called party's local time. | 47 CFR 64.1200(c)(1) |
| National DNC | Safe harbor requires written procedures, training, a company DNC list, and use of a registry version obtained **no more than 31 days** before the call. A "signed, written agreement" with the seller that includes the phone number permits calls to DNC-registered numbers. | 47 CFR 64.1200(c)(2) |
| Company-specific DNC | Written policy on demand; training; record and honor DNC requests within 10 business days; identify caller, seller and contact number; honor for **5 years**. | 47 CFR 64.1200(d) |
| TSR consent records | Sellers/telemarketers keep records **5 years**; a complete consent record includes name and number, **a copy of the request for consent in the same manner and format it was presented**, purpose, copy of consent, date. | 16 CFR 310.5(a)(8), [eCFR](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-310/section-310.5) |
| Florida FTSA PEWC | Written agreement that bears the called party's signature; clearly authorizes the person making or allowing the call to deliver telephonic sales calls by call, text or voicemail using "an automated system for the selection **and** dialing of telephone numbers", a recorded message, or prerecorded voicemail; includes the phone number; clear and conspicuous disclosure of authorization and not-a-condition-of-purchase. 2023 amendment (HB 761, ch. 2023-150) narrowed the autodialer wording and allows signature by acts such as checking a box. | s. 501.059(1)(g), (8)(a), [2026 F.S.](https://www.flsenate.gov/Laws/Statutes/2026/501.059); [HB 761 (2023)](https://www.flsenate.gov/Session/Bill/2023/761) |
| FTSA text opt-out and damages | Before suing over text solicitations, the called party must reply "STOP"; the solicitor has **15 days** to stop. Damages: greater of actual or **$500**, up to 3x if willful/knowing. | s. 501.059(10) |
| Florida "no sales solicitation calls" list | State list kept by FDACS (quarterly); no unsolicited telephonic sales call to listed numbers. | s. 501.059(3)–(4) |
| Florida calling hours and frequency | No commercial telephone solicitation call before **8 a.m. or after 8 p.m.** local time; no more than **3 calls in 24 hours** on the same subject from any number; no caller-ID blocking or spoofing. | s. 501.616(6)–(7), [2026 F.S.](https://www.flsenate.gov/Laws/Statutes/2026/501.616) |
| California ADAD hours | Automatic dialing-announcing devices may not call California phones **between 9 p.m. and 9 a.m.** California time (as amended by AB 956, 2019). Not read on leginfo (site blocked automated access); confirm. Also confirm whether Pub. Util. Code 2874 (live-operator introduction for ADAD messages) applies to prerecorded calls made with consent. | Cal. Pub. Util. Code 2872(c), 2874; [AB 956 (2019) text](https://www.legiscan.com/CA/text/AB956/2019) (secondary mirror) |
| CCPA coverage | A "business" includes one that **derives 50 percent or more of its annual revenues from selling or sharing** personal information, regardless of size (other prongs: revenue over $26,625,000 as adjusted for 2025; or buying/selling/sharing PI of 100,000+ consumers or households). | Civ. Code 1798.140(d)(1), [CPPA statute PDF eff. 2026-01-01](https://cppa.ca.gov/pdf/20260101_ccpa_statute.pdf); [CPPA thresholds](https://cppa.ca.gov/regulations/cpi_adjustment.html) |
| Notice at collection | At or before collection: categories collected, purposes, **whether each category is sold or shared**, **retention period per category**, link to the opt-out notice, link to privacy policy. A web-form link must go **directly to the section** with this content. | 11 CCR 7012(c), (e), (f), [CCPA Regulations eff. 2026-01-01](https://cppa.ca.gov/regulations/pdf/ccpa_statute_eff_20260101.pdf) |
| Opt-out of sale/sharing | Stop within **15 business days**; notify third parties sold to between request and compliance. "Do Not Sell or Share" link required. | 11 CCR 7013, 7026(f) |
| Global Privacy Control | A business that sells or shares must treat a qualifying opt-out preference signal (e.g. GPC header) as a valid opt-out for the browser and, if known, the consumer; and **must display whether it processed the signal** (e.g. "Opt-Out Request Honored"). | 11 CCR 7025(b), (c)(1), (c)(6) |
| Privacy policy content | Includes, among others, the date last updated, categories, sources, purposes, categories of third parties sold/shared to, retention, rights and how to exercise them. | 11 CCR 7011 |
| Request records | Keep records of consumer requests and responses for **24 months**. | 11 CCR 7101 |
| Risk assessment | **Selling or sharing PI** is significant-risk processing; a risk assessment is required **before** starting it (processing begun before 2026-01-01: by 2027-12-31). Retain 5 years. | 11 CCR 7150(b)(1), 7155 |

## 3. Gap table

Risk: **H** = could plausibly create per-call statutory damages or a regulator finding; **M** = weakens the
defense or a disclosure gap; **L** = good practice.

| # | Requirement | Current state | Risk | Recommended fix (for counsel to approve) |
|---|---|---|---|---|
| 1 | PEWC must cover **advertisements/telemarketing** (federal) and **telephonic sales calls** (FL), not just "contact". | "may contact me about solar". Does not say marketing, sales, or that calls will be to sell solar systems. | H | Say "marketing and sales calls and texts about solar systems, batteries and financing". |
| 2 | PEWC must include **the telephone number** (federal (f)(9), FL (1)(g)3; DNC exemption (c)(2)(ii) also). | "at the phone number ... I provided". The number itself is not in the text and not stored inside `consent_text`. | M | Insert the number in the shown and stored text ("at (305) 555-0123"). Requires a new consent version, server composition and trigger update. |
| 3 | Seller identification. Federal PEWC authorizes "the seller"; FTSA "the person making or allowing" the call. One-to-one is vacated, so multiple named sellers are allowed federally. | Named-installer version lists legal names (good). Generic version authorizes "solar installers serving my area" (no seller identified). | H (generic) / L (named) | Keep the generic version for **email follow-up only** (no phone/text consent for unnamed companies). When a buyer later serves the ZIP, get fresh consent (email link to a page with the named-installer checkbox). Fix privacy text that implies the request will later be shared on the old consent. |
| 4 | Clear and conspicuous disclosure; signature under E-SIGN. | Unchecked box + button; text next to the box; 14px gray (stone-700) on white; names also listed above. | L | Keep. Consider slightly larger/darker text and keeping the text on screen without scrolling at 320px width. Record the checkbox event (see 7). |
| 5 | "Not a condition of purchase", plus no indirect conditioning. | Statement present, but the form cannot be submitted without the box, so quotes require consent. | M | Counsel decision. Common mitigations: an alternative path to quotes without autodialed/prerecorded consent (e.g. "Prefer not to? Email me quotes instead" or a phone number to call), or split the box. |
| 6 | Prerecorded messages and CA ADAD rules. | Consent covers prerecorded messages for all named parties. Nothing restricts buyers' use of prerecorded calls to CA numbers. | M | Ask counsel whether to drop "prerecorded messages" (installers rarely need it). If kept, contract buyers to comply with Cal. Pub. Util. Code 2872/2874 and identification rules in 64.1200(b). |
| 7 | Consent proof: TSR "copy of the request for consent in the same manner and format it was presented"; burden is on the seller. | Stores exact text, version, time, IP, page URL, UA, installer list. No page snapshot, no checkbox/click event, no build id, no record of the step-3 surrounding text. TrustedForm is off. | M | Store a hash and copy of the rendered step-3 HTML (or a versioned template id + git commit) and a `consent_checked_at` client event. Decide on a third-party certificate (TrustedForm/Jornaya); see 15 for the privacy trade-off. |
| 8 | Record retention: TSR 5 yrs; FCC DNC requests 5 yrs; TCPA limitations 4 yrs (28 U.S.C. 1658); CCPA request records 24 months. | Privacy page: kept "until you ask us to delete it". No retention schedule. A delete request could remove the consent record. | H | Adopt a retention schedule: lead and consent evidence 5 years from last contact (counsel to set); on deletion requests keep a minimal consent/suppression record under the CCPA legal-claims exception (Civ. Code 1798.105(d)), and say so. |
| 9 | Revocation: any reasonable means; 10 business days; no exclusive method. | Text says "Reply STOP to opt out" only (texts). Privacy form handles Do Not Sell / Delete, not "stop calling me". No process to tell buyers who already have the lead that the person revoked. | H | Add "You can opt out at any time by replying STOP, telling the caller, or contacting RayValue at [email/phone]". Add a "Stop calls and texts" request type that forwards to every buyer who received the lead within 1 business day; contract buyers to honor within 10 business days (sooner for FL texts: 15 days is the suit gate, not a target). |
| 10 | National DNC and Florida state list; quiet hours (federal 8 a.m.–9 p.m.; FL 8 a.m.–8 p.m. and 3 calls/24 h; CA ADAD 9 a.m.–9 p.m.). | Not RayValue's code path today (buyers call). Buyer agreements are not in the repo. `business_hours` in buyers only controls when RayValue *delivers*, not when buyers call. | H | Buyer agreement must require: TCPA/FTSA/CA compliance, calls only within the strictest window (FL leads 8 a.m.–8 p.m., CA leads 9 a.m.–8 p.m. or as counsel sets), max 3 attempts/24 h for FL, DNC and FL-list scrubbing for any call outside the consent, internal DNC, caller ID not blocked. If RayValue ever calls or texts for marketing: registry subscription (SAN), FL list, written DNC policy, training. |
| 11 | Wrong or reassigned numbers. | Phone verification optional; unverified leads sell. No Reassigned Numbers Database check. | M | Require OTP before selling (or sell unverified leads only to buyers who accept the risk in writing). Buyers to use the FCC Reassigned Numbers Database (safe harbor 64.1200(m)). |
| 12 | SMS program disclosures (carrier/CTIA practice, 10DLC registration, not law). | "Message and data rates may apply. Reply STOP to opt out." No frequency, no HELP. | L | Add "Message frequency varies. Reply HELP for help." |
| 13 | CCPA coverage. | If lead sales become 50%+ of revenue, RayValue is a CCPA "business" at any size. | H (once selling) | Treat as covered from the first lead sale. |
| 14 | CCPA notice at collection on the form, linking **directly** to the right section; per-category sold/shared and retention. | Only a "Privacy Policy" link to the top of `/privacy` inside the consent; no "Notice at Collection" heading; no retention; no categories table. | H | Add a "Notice at collection" section (anchor `#notice-at-collection`) with category / purpose / sold-or-shared / retention table, and a link next to the submit button: "Notice at collection" and "Do Not Sell or Share My Personal Information". |
| 15 | GPC / opt-out preference signals, and showing the status. | No GPC handling anywhere (no `Sec-GPC` read). | H | On `/api/leads`, read `Sec-GPC: 1`; if set (and the person is in CA, or everywhere for simplicity), do not route the lead, or show a conflict notice and ask for consent per 11 CCR 7025(c)(3). Display "Opt-Out Request Honored" when the signal is detected. Counsel to decide whether quote delivery to the named installers is a "sale" or a consumer-directed disclosure (Civ. Code 1798.140(ad)(2)(A) exception), which changes how much of this is needed. |
| 16 | Opt-out mechanics: no verification for opt-outs; 15 business days; tell third parties. | Form asks for email; suppression matches email (and other leads with the same phone). No buyer notification after sale. | M | Accept phone as an identifier too; notify buyers of opt-outs received after delivery; log date and response for 24 months. |
| 17 | Third-party contract terms for sale (Civ. Code 1798.100(d); 11 CCR 7053). | No buyer agreement in the repo. | H | Buyer agreement: limited purpose (solar quote for this consumer), no resale, CCPA compliance, honor opt-outs, delete on request, notify on breach, audit right; plus the TCPA/FTSA terms in row 10 and indemnity. |
| 18 | CCPA risk assessment for selling PI. | None. | M | Document a risk assessment before selling CA leads (11 CCR 7150–7155). |
| 19 | Privacy policy content (11 CCR 7011). | No "last updated" date; no categories/sources/third-party categories in CCPA terms; no retention; email provider unnamed; says "stop sharing it" rather than naming the right; FAQ says "never sell it to other marketers" while the policy says "We may sell or share" (consistent in substance, but counsel may want one term). | M | Add date, CCPA sections, retention, named providers; align FAQ wording. |
| 20 | Financial incentive notice (11 CCR 7016) if free quotes are offered in exchange for PI that is sold. | None. | M | Counsel question (Q8). |
| 21 | Session-replay/wiretap exposure if TrustedForm (or similar) is enabled (Cal. Penal Code 631 "CIPA"; Fla. Stat. 934 "FSCA"). | Off by default; enabling requires CLAUDE.md rule 7 change. | M (if enabled) | Only enable after counsel review; disclose in the form and policy before the script loads. |
| 22 | Estimate-email consent bundles marketing email with the requested email. | Single checkbox: estimate + "occasional updates". Unsubscribe link and suppression list exist. | L | CAN-SPAM does not require opt-in; fine as is. Optional: separate the two. |
| 23 | Version history and audit. | Old trigger text (0005) remains in migrations; live trigger verified to be 0006. | L | Keep a consent-version log (this doc, section 1) and add a `consent_versions` table with effective dates and full text when wording changes. |

## 4. Proposed revised consent text (draft for counsel, not live)

Named-installer version (replaces 2026-10-25.1). Bracketed parts are filled by the server and stored verbatim:

> By checking this box and clicking "Get my free quotes," I agree that RayValue and **[Installer A, Installer
> B, and Installer C]** may call and text me at **[(305) 555-0123]** with marketing and sales messages about
> solar systems, batteries and financing, including calls and texts made with an automated system and
> prerecorded or artificial-voice messages, and may email me at **[name@example.com]**. I understand this
> consent is not a condition of buying anything, and I can get quotes without it by [emailing / calling
> RayValue at ...]. Message frequency varies. Message and data rates may apply. I can opt out at any time by
> replying STOP, telling the caller, or contacting RayValue at [contact]. Reply HELP for help. See the Notice at
> Collection and Privacy Policy, including how to opt out of the sale or sharing of my information.

No-installer version (replaces 2026-10-25.2; email only, no phone/text consent):

> By checking this box and clicking "Save my request," I agree that RayValue may email me at
> **[name@example.com]** when an installer serves my ZIP code, and save my request until then. RayValue will
> not share my information with any installer unless I agree again, by name, to hear from that installer.
> I can unsubscribe at any time. See the Notice at Collection and Privacy Policy.

Next to the submit button (both versions): links "Notice at collection" (to `/privacy#notice-at-collection`)
and "Do Not Sell or Share My Personal Information".

Implementation notes (do only after counsel signs off): new versions in `src/lib/leads/consent.ts`, a new
migration replacing `leads_set_consent` with the same constants (and phone/email composition), update
`consent.test.ts`, button label if it changes, and the privacy page sections in rows 8, 14, 15 and 19.
Delete "prerecorded or artificial-voice" if counsel advises (row 6).

## 5. Questions for counsel

1. With one-to-one vacated, is naming up to 3 installers plus RayValue in one checkbox enough under the FTSA
   (s. 501.059(1)(g)) as well as federally, given *McLaughlin* means courts may read PEWC afresh?
2. Must the phone number appear inside the agreement text, or is "the phone number I provided" (with the field
   on the same screen) enough? Same for the FL definition.
3. Is requiring the box to get quotes "conditioning" under 64.1200(f)(9)(i)(B) / s. 501.059(1)(g)4.b? Do we
   need an alternative no-consent path, and what form?
4. Should RayValue be named as a party that may call/text at all if it does not plan outbound marketing calls?
   If it stays, which obligations attach (DNC SAN, FL list, written DNC policy, FL Telemarketing Act license
   under s. 501.605 or an exemption)?
5. Keep or drop prerecorded/artificial voice consent? Do Cal. Pub. Util. Code 2872/2874 apply to consented
   prerecorded calls by installers?
6. What calling window and attempt cap should buyer contracts impose for FL and CA leads (federal 8–9,
   FL 8–8 with 3/24h, CA ADAD 9–9)?
7. Is delivering a lead to the installers the consumer names a CCPA "sale" or a consumer-directed disclosure
   (Civ. Code 1798.140(ad)(2)(A))? How does that change the GPC handling (row 15), opt-out link and risk
   assessment?
8. Do "free quotes" in exchange for contact details require a Notice of Financial Incentive (11 CCR 7016)?
9. Is RayValue a California data broker under the Delete Act (Civ. Code 1798.99.80) given it has a direct
   relationship with the consumer? Any Florida registration?
10. Retention: how long to keep lead and consent records (TSR 5 years, FCC DNC 5 years, TCPA 4-year limitations,
    FTSA limitations period?) and how to answer CCPA delete requests while keeping a suppression/consent record?
11. What minimum proof do buyers and their insurers expect (TrustedForm/Jornaya certificate vs first-party
    snapshot)? If a third-party script is used, what disclosures avoid CIPA 631 / FSCA chapter 934 claims?
12. What should the buyer agreement contain (TCPA/FTSA/CCPA terms, indemnity, insurance, audit, return policy
    for bad numbers, no resale, opt-out forwarding SLA)?
13. Is the "revoke-all" rule (delayed to 2027-01-31) something to design for now, given RayValue and installers
    are separate callers?
14. Is selling leads whose phone was not verified by OTP an acceptable risk, or should verification be required?
15. Does the Florida Digital Bill of Rights (s. 501.701 et seq.) apply? (It appears limited to very large
    controllers; please confirm.)
16. Any additional disclosures needed for ads traffic (Google/Meta lead-gen policies, landing-page claims such
    as "Free and no obligation" and "Up to 3 local installers")?

## 6. Verification log

- 47 CFR 64.1200: eCFR renderer API, current text, version list ending 2026-03-25. Read (a)(10)–(12), (b),
  (c)(1)–(2), (d), (f)(9)–(10).
- 16 CFR 310.5: eCFR current text.
- Fla. Stat. 501.059 and 501.616: 2026 Florida Statutes (Online Sunshine), read 2026-10-25.
- CCPA statute and regulations: CPPA PDFs "effective 1/1/2026", read 2026-10-25 (1798.140(d); 11 CCR 7011,
  7012, 7013, 7025, 7026, 7101, 7150, 7155).
- *Insurance Marketing Coalition v. FCC*: 11th Cir. slip opinion PDF (filed 2025-01-24; vacates Part III.D).
- *McLaughlin v. McKesson*: Supreme Court docket 23-1226 (reversed and remanded, June 20, 2025).
- FCC 12-21: E-SIGN paragraph confirmed in the PDF.
- Not confirmed from a primary source: the Federal Register cite for the FCC's removal of the one-to-one text;
  the January 2026 order delaying revoke-all to 2027-01-31 (secondary sources agree); current Cal. Pub. Util.
  Code 2872/2874 text (leginfo blocked automated access).
- Live DB: `public.leads_set_consent` read with a read-only query on 2026-10-25; template and versions match
  0006; zero leads stored.
