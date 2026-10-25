# Nurture email (Phase 6.2)

Five plain-text emails over about three weeks for people who asked to "email me this estimate" (and, optionally,
leads saved as "just researching"). **Nothing is sent until you finish the setup below.**

| # | When | Subject | Purpose |
|---|------|---------|---------|
| 1 | immediately | Your RayValue solar estimate | the estimate they saw, and a link back to the calculator |
| 2 | day 2 | How to read a solar quote | checklist for reading installer quotes |
| 3 | day 5 | Buy, lease or PPA: what is the difference? | the three ways to get solar |
| 4 | day 10 | Is a battery worth it in Florida / California? | FL outages, CA NEM 3.0 (state specific) |
| 5 | day 18 | Ready for real numbers? | quotes link prefilled with the state, tagged `utm_source=nurture` |

Copy lives in `src/emails/nurture.ts` (edit it there; tests in `src/emails/nurture.test.ts` check the unsubscribe
link, the mailing address, no dollar or percent figures and no tax credit claims). The schedule is
`src/lib/nurture/schedule.ts`; the job is `src/lib/server/nurture.ts`, called daily by `/api/cron/nurture`
(`vercel.json`, 15:00 UTC).

## Rules the job follows
- Email 1 is the estimate email sent when the person asks (`/api/estimate-email`). The job sends it only if that
  immediate send did not happen (provider was not configured yet).
- At most one email per person per run, at least about a day apart, and nothing to sign-ups older than 35 days.
- Never to anyone in `email_suppressions` (unsubscribed) or with a `delete` / `do_not_sell` request in `data_requests`.
- One sequence per email address.
- If any database read fails, nothing is sent.
- Leads with status `nurture` are included only with `NURTURE_INCLUDE_LEADS=true`: the quote-form consent wording says
  installers and RayValue may contact the person about solar quotes; get your attorney to confirm that covers
  marketing email before turning it on.

## Owner setup
1. Apply `supabase/migrations/0010_nurture_and_kpi.sql`.
2. Choose and verify an email provider (Resend adapter is built): `RESEND_API_KEY`, `EMAIL_FROM` (verified sender domain).
3. Set `NURTURE_MAILING_ADDRESS` to your real postal address (required by CAN-SPAM; the emails print it as
   `{{MAILING_ADDRESS}}` until then and the job refuses to send without it).
4. Set `UNSUBSCRIBE_SECRET` (random, 16+ chars) and `CRON_SECRET` (16+ chars).
5. Read and edit the copy in `src/emails/nurture.ts`; have it reviewed.
6. Set `NURTURE_ENABLED=true`. Optional: `NURTURE_INCLUDE_LEADS=true`, `SITE_URL` (default https://rayvalue.com).
7. Name the email provider in `/privacy`.

Unsubscribe links go to `/unsubscribe?t=<signed token>`, which records the opt-out immediately (and accepts the
one-click `POST` that mail clients send for the `List-Unsubscribe` header).
