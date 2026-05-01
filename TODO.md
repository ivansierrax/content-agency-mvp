# TODO — content_agency_mvp

> Session-level next-actions. Updates every session.
> For the locked 14-day plan, see `PLAN.md`.

## Right now (Day 1 — Bootstrap)

1. [x] Pre-flight done — all 4 services provisioned (see CREDENTIALS.md)
2. [ ] Init `content_agency_mvp/` as TypeScript project (npm init -y, tsconfig.json, src/, tests/)
3. [ ] Create GitHub repo `hashtagagencia/content_agency_mvp` (private)
4. [ ] Create Supabase project, capture URL + service-role key
5. [ ] Create Railway project, link GitHub repo
6. [ ] Create Sentry project, capture DSN
7. [ ] Configure GitHub Actions: typecheck + test on PR
8. [ ] Port `content_pipeline/eval/run.mjs` → `src/pipeline/run.ts` (relocate + TS, no logic change)
9. [ ] First Railway deploy: `npm start` runs eval against a SMOKE-S57 fixture
10. [ ] Verify: trigger an error → see it in Sentry within 30s

**Day 1 done = repo deploys to Railway, eval runs in container, Sentry captures errors.**

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
