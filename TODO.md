# TODO — content_agency_mvp

> Session-level next-actions. Updates every session.
> For the locked 14-day plan, see `PLAN.md`.

## Right now (Day 1 finish — Railway deploy + Sentry smoke)

1. [x] Pre-flight done — all 4 services provisioned (see CREDENTIALS.md)
2. [x] Init `content_agency_mvp/` as TypeScript project (npm init, tsconfig, src/index.ts, src/lib/env.ts, src/lib/sentry.ts)
3. [x] Create GitHub repo `ivansierrax/content-agency-mvp` (private) + initial commit pushed
4. [x] Supabase project provisioned (Day 0)
5. [x] Railway project provisioned (Day 0) — but NOT yet linked to GitHub
6. [x] Sentry project provisioned + DSN captured (Day 0)
7. [x] Configure GitHub Actions: typecheck on PR/main
8. [ ] Link Railway project to GitHub `ivansierrax/content-agency-mvp` repo
9. [ ] Set Railway env vars from CREDENTIALS.md: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY` (TBD — Day 2 will create dedicated key for cost tracking), `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`, `NODE_ENV=production`
10. [ ] Add Railway start command: probably needs Procfile (`web: npm run start`) or railway.json + a build step (`npm run build` to produce dist/index.js)
11. [ ] First Railway deploy (push to main triggers it once GitHub is linked; may need manual trigger first time)
12. [ ] Verify: run `npm run smoke -- --throw` on Railway → see error in Sentry within 30s
13. [ ] Port `content_pipeline/eval/run.mjs` → `src/eval/run.ts` (DEFERRED to Day 2-3 — Day 1's smoke is the boot, port is downstream)

**Day 1 done = Railway boot+throw test lights up Sentry dashboard.** Until we see that error, Day 1 isn't truly closed.

## This week (Week 1 — rest of)

- Day 2 (Tue): Postgres schema + service modules + Brand 0 seeded
- Day 3 (Wed): Pipeline engine parameterized by brand_config + prompt caching
- Day 4 (Thu): Designer port (HCTI + Gemini + GCS + GDrive as TS modules)
- Day 5 (Fri): Notion integration (5-min config sync to Postgres)

## Next week (Week 2)

- Day 6 (Mon): Multi-brand testing (3 brands isolated)
- Day 7 (Tue): Onboarding CLI (Maria-runs-it, <60 min)
- Day 8 (Wed): Per-brand publishing (correct IG account routing)
- Day 9 (Thu): Reliability hardening (Sentry hooks, circuit breakers, runbook)
- Day 10 (Fri): E2E validation + first real brand onboarded

## Open questions (need answer before relevant day)

- **Day 7:** Maria's availability for first onboarding rehearsal? (target: Day 10 afternoon)
- **Day 10:** Which real brand is #1? (decide by end of Week 1)
- **Week 3:** LinkedIn API — does posting require App Review? (research in Week 2)
- **Day 2:** encrypted credentials — `pgcrypto` (DB-side) or app-level AES (Node-side)? (decide on Day 2; log to DECISIONS.md)

## Backlog (not in MVP, capture so we don't forget)

- LinkedIn integration (weeks 3-4)
- Learning loop: top-20% performers → few-shot examples (weeks 5-6)
- Admin app for Ivan/Maria (single-pane control surface) (weeks 5-6)
- Per-brand custom-domain webhooks (post-MVP)
- Analytics dashboard for Ivan (weeks 7-8)
- LinkedIn-specific content shapes (carousel image vs. text post) (weeks 3-4)
- TikTok/Reels (post-MVP, Q3?)

## Decision-log triggers (add D-### to DECISIONS.md if any of these come up)

- Switching from Supabase to self-hosted Postgres
- Adding a non-Notion creative-control surface
- Changing from Railway to another deploy target
- Adding cross-brand data sharing
- Skipping prompt caching
- Bypassing the per-brand circuit breaker pattern
