# RayValue: instructions for coding agents (Codex and others)

The project rules live in [CLAUDE.md](CLAUDE.md) and apply to every agent: never invent numbers, the federal 25D credit
is $0 for 2026+, results are ranges, all math is pure functions in src/lib/calc/, there are no trackers, and API
keys live only in environment variables. Read it first.

## Posting to Instagram and Facebook

RayValue posts to Instagram and a Facebook Page through its own queue. **An agent never calls the Meta API directly
and never handles the tokens.** It creates posts in the queue, the owner approves them, and the server publishes them.

### How it works
1. **Generate.** `npm run social:generate` renders a Reel (MP4) or carousel (JPEG) from RayValue's live data and queues
   it as a post in Supabase (`social_posts`). It never publishes. See the header of `scripts/social/generate.ts`.
2. **Review.** The owner previews, edits, schedules or rejects posts at https://rayvalue.com/admin/social.
3. **Publish.** `/api/cron/social-publish` (`src/lib/server/social-publisher.ts`) publishes scheduled posts every 15
   minutes, run by `.github/workflows/social-cron.yml`. It re-runs the content checks right before publishing and
   honours `social_settings.paused`.

### Commands an agent may run (from the repo root)
```bash
# Preview locally only: renders into ./out/social/... and writes nothing to Storage or the database
npm run social:generate -- --template utility-payback-reel --target fpl --dry-run

# Queue as a DRAFT for the owner to review (no slot, not scheduled)
npm run social:generate -- --template utility-payback-reel --target fpl --channel instagram --draft
npm run social:generate -- --auto --draft
```
Template keys are in `src/lib/social/template-keys.ts`. Channels are `instagram` and `facebook`.

### Rules
- **Always use `--draft`** (or `--dry-run`), so every creative is shown to the owner before it goes out. Never schedule
  or publish a post yourself, and never change `social_settings` (auto-publish, paused, default channels).
- **Show the owner the rendered file** from `./out/social/...` (or the draft link in /admin/social) and wait for approval.
  Text-only motion graphics have been rejected before; use real photos and data visuals.
- **Every number in a caption or slide must come from RayValue's database**, the same as on the site. No made-up stats.
- **Never print, log, copy or commit tokens.** Credentials are read automatically from the gitignored `.dev.vars`
  (local) or Vercel env (production). Variable names only: `IG_USER_ID`, `IG_ACCESS_TOKEN`, `IG_APP_ID`, `IG_APP_SECRET`,
  `FB_PAGE_ID`, `FB_PAGE_TOKEN`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`. Never send them to any other service.
- **Use `SOCIAL_DRY_RUN=1`** for any test that runs the publisher code path. It blocks every Instagram and Facebook write.
- Public profiles for reference: Instagram https://www.instagram.com/rayvalue_usa/ · Facebook https://www.facebook.com/1307379799134896

### Token care (owner)
The Instagram token refreshes daily and is stored in the `social_auth` table. The Facebook token is a never-expiring system-user
Page token. If a refresh fails, the owner gets an email; the fix is in `docs/LAUNCH.md` (search "social").
