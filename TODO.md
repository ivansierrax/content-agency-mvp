# TODO — content_agency_mvp

> Session-level next-actions. Updates every session.
> For the locked 14-day plan, see `PLAN.md`.

## Day 1 — ✅ DONE (2026-04-30 late-night)

All steps complete. Service live, Sentry verified end-to-end. See SESSION_LOG.md for details.

## Right now (Day 2 — Data layer + Brand 0)

1. [ ] Generate dedicated Anthropic API key for this project (https://console.anthropic.com → API Keys → Create). Replace placeholder in Railway env (currently `sk-ant-PLACEHOLDER-DAY2-DEDICATED-KEY-NEEDED`). Track cost separately from n8n key.
2. [ ] Decide encrypted credentials approach: `pgcrypto` (DB-side) or app-level AES (Node-side). Log to DECISIONS.md as D-008.
3. [ ] Write Supabase migration SQL: `supabase/migrations/0001_init.sql` — `brands`, `brand_configs`, `post_queue`, `post_results`, `analytics_snapshots`
4. [ ] Apply migration to Supabase (via dashboard SQL editor or `supabase` CLI)
5. [ ] Create `src/lib/supabase.ts` — typed client wrapper using publishable + secret keys
6. [ ] Create `src/db/brands.ts` — `getBrandConfig(brand_id)`, `listActiveBrands()`
7. [ ] Create `src/db/posts.ts` — `enqueuePost`, `updatePostStatus`, `markFailed`
8. [ ] Insert Brand 0 (Hashtag Agencia) row + brand_config mirrored from current Notion (voice, pillars, banned_words, target_audience, IG account ID)
9. [ ] Verify locally: `node -e "import('./dist/db/brands.js').then(m => m.getBrandConfig(0)).then(console.log)"` prints Brand 0's config
10. [ ] Verify on Railway: redeploy + curl `/health` → `brands: [...]` populated (update health handler)

**Day 2 done = Brand 0 row exists in Postgres, config readable from Node service, /health on Railway shows Brand 0 status.**

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
