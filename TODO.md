# TODO — content_agency_mvp

> Session-level next-actions. Updates every session.
> For the locked 14-day plan, see `PLAN.md`.

## Day 1 — ✅ DONE (2026-04-30 late-night)

## Day 2 — ✅ DONE (2026-05-01)

All steps complete. Data layer + Brand 0 (Hashtag) seeded + /health surfaces brand. See SESSION_LOG.md for details.

## Right now (Day 3 — Pipeline engine + prompt caching)

1. [ ] Create `src/lib/anthropic.ts` — Anthropic SDK wrapper with prompt caching (`cache_control: { type: 'ephemeral' }` on system prompts). Helper `complete({ system, messages, model, temperature, max_tokens })` returns `{ text, usage }`. Default model: Sonnet 4.6 (`claude-sonnet-4-6`). Log cache hit rate (`usage.cache_read_input_tokens / usage.input_tokens`) to Sentry breadcrumbs.
2. [ ] Create `src/pipeline/types.ts` — pipeline envelope shape (`PostEnvelope` with `brand_id`, `topic`, `pillar`, `outline`, `body`, `editor_notes`, `qg_verdict`, etc.) — each agent reads input slice + appends its output slice.
3. [ ] Pull existing Strategist prompt from n8n workflow `UR5qfUcOoO6djxIP` (use n8n MCP `n8n_get_workflow`). Save canonical version to `src/pipeline/strategist.prompt.ts` as a TypeScript template-literal export.
4. [ ] Create `src/pipeline/strategist.ts` — `runStrategist({ brand_identity, topic? })` — composes system prompt from brand pillars + blueprint + voice notes, calls Anthropic SDK with caching, returns `{ chosen_pillar, suggested_topic, recipe_hint }`.
5. [ ] Add `POST /run-pipeline` endpoint — body `{ brand_slug, topic? }`, runs Strategist only for Day 3, returns the post envelope. Persists via `enqueuePost` with status='strategist'.
6. [ ] Smoke test against Brand 0: `curl -X POST .../run-pipeline -d '{"brand_slug":"hashtag"}'` → returns a chosen pillar + topic. Verify Sentry breadcrumb shows `cache_read_input_tokens > 0` on second call.
7. [ ] If time: port Writer agent same day (n8n `uNFrmhzbddDfxFbU`) — extends chain to status='writer'.

**Day 3 done = `/run-pipeline` runs Brand 0 through at least Strategist; cache hit rate visible in breadcrumbs; post_queue row created with status='strategist' (or 'writer' if stretch goal hit).**

## This week (Week 1 — rest of)

- Day 3 (Wed): Pipeline engine — Anthropic SDK wrapper + prompt caching + Strategist (and Writer if time)
- Day 4 (Thu): Editor + Spanish Editor + Quality Gate + Designer (HCTI + Gemini + GCS + GDrive ports)
- Day 5 (Fri): Notion sync — `src/sync/notion-brand.ts` reads 9 DBs filtered to Client=<brand>, upserts brand_identity. Cron 5-min loop. `POST /admin/refresh-brand/:slug` endpoint. Verify Hashtag's 45 rows fully populate.

## Next week (Week 2)

- Day 6 (Mon): Multi-brand testing (3 brands isolated, no cross-brand leakage)
- Day 7 (Tue AM): Onboarding CLI (Maria-runs-it, <60 min). **Day 7 PM: Hashtag IG token rotation atomic session per D-011** (~25-40 min, Chrome + Graph API Explorer).
- Day 8 (Wed): Per-brand publishing (Node-side IG publish or hand-off-to-Publisher-A6 with brand-specific token). Wire `recordPublishSuccess` end-to-end.
- Day 9 (Thu): Reliability hardening — retry+timeout+circuit-breaker per external call, per-brand circuit breakers, runbook
- Day 10 (Fri): E2E validation + first real brand onboarded

## Open questions (need answer before relevant day)

- **Day 3:** Use Sonnet 4.6 (`claude-sonnet-4-6`) for all chain steps in MVP, or Haiku for lighter steps (Editor/Spanish Editor)? Default plan: Sonnet across the board for consistency; revisit on Day 9 cost review.
- **Day 5:** Notion API token — generate a new Notion integration scoped to the 9 brand DBs (and the Strategy parent page), or reuse existing one? Default: new dedicated integration `content-agency-mvp-sync` for clean revoke path.
- **Day 7 PM:** Maria's availability for first onboarding rehearsal? (target: Day 10 afternoon)
- **Day 10:** Which real brand is #1? (decide by end of Week 1)
- **Week 3:** LinkedIn API — does posting require App Review? (research in Week 2)

## Backlog (not in MVP, capture so we don't forget)

- LinkedIn integration (weeks 3-4)
- Learning loop: top-20% performers → few-shot examples (weeks 5-6)
- Admin app for Ivan/Maria (single-pane control surface) (weeks 5-6)
- Per-brand custom-domain webhooks (post-MVP)
- Analytics dashboard for Ivan (weeks 7-8)
- LinkedIn-specific content shapes (carousel image vs. text post) (weeks 3-4)
- TikTok/Reels (post-MVP, Q3?)
- KMS for `MASTER_ENCRYPTION_KEY` (post-MVP per D-008)
- `supabase gen types typescript` to replace hand-rolled `src/db/types.ts` (Day 9+)

## Decision-log triggers (add D-### to DECISIONS.md if any of these come up)

- Switching from Supabase to self-hosted Postgres
- Adding a non-Notion creative-control surface
- Changing from Railway to another deploy target
- Adding cross-brand data sharing
- Skipping prompt caching
- Bypassing the per-brand circuit breaker pattern
- Reading brand identity directly from Notion at pipeline-time (would supersede D-010)
