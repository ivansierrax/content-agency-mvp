# TODO — content_agency_mvp

> Session-level next-actions. Updates every session.
> For the locked 14-day plan, see `PLAN.md`.

## Day 1 — ✅ DONE (2026-04-30 late-night)
## Day 2 — ✅ DONE (2026-05-01)
## Day 3 first iteration — ✅ DONE (2026-05-02 CST)
## Day 4 — ✅ DONE (2026-05-02 CST)
## Day 5 (minimum) — ✅ DONE (2026-05-02 CST)

Notion brand-identity sync live. Hashtag synced 80 rows in 1.9s. Day-4 smoke re-runs cleanly with REAL pillar/recipe/hook/CTA (`"AI / Marketing con IA"` / `DEATH_DATA` / `"Death 2 — operating-dead-model"` / `"AI • Save"`), all with Notion-linked Postgres IDs. See SESSION_LOG.md Session 5 for full trace.

D-014 logged: shared agency DBs + per-brand `Client` select filter (single-replica caveat documented).

Designer port deferred to Day 6 (clean session, focused 4-6h block — TODO already allowed).

## Right now (Day 6 — Designer port + multi-brand testing)

1. [ ] Pull Designer A4 (`8KYkBaKg3yeRummd`) via n8n MCP. Read the HCTI rendering chain + Gemini object/person prompt builder + GCS upload + GDrive backup. Decide port boundary (probably hosted HCTI same as production; in-process Gemini SDK; GCS via `@google-cloud/storage`).

2. [ ] Build `src/pipeline/designer.ts` — consume `WriterDraft` from `post_queue.payload` (status=ready), iterate slides:
   - typography_dark / typography_light / data_card → HCTI render (HTML template per `slide_type`, fed by brand_themes colors/fonts + slide content).
   - object_photo → Gemini image gen with the Strategist's `object_concept` baked into prompt + brand_identity.photo rules.
   - person_photo → Gemini image gen with brand_identity.photo person rules; `person_prompt` filled here (Writer leaves it empty).
   - closing_cta → HCTI render with CTA-Bank text.
   Upload each rendered image to GCS, get public URL, write back to slide.url. Advance `status` to `designed`.

3. [ ] Add Day 6 env vars (HCTI_USER_ID + HCTI_API_KEY + GEMINI_API_KEY + GCS_BUCKET + GCS_SERVICE_ACCOUNT_JSON) to Railway. Same `New Variable` button pattern as Day 5.

4. [ ] Smoke test: re-run Day 5's Stack Overflow draft through Designer; verify all 7 slides have valid GCS URLs and images render visually correctly.

5. [ ] Day 6 PM (if time permits): multi-brand isolation test. Insert synthetic Brand 1 with `notion_client_filter='Test'` (will return 0 rows from Hashtag DBs — perfect isolation test). Confirm Strategist for Brand 1 can't see Brand 0's pillars.

**Day 6 done minimum = `/run-pipeline` produces a fully-rendered carousel with real image URLs, status=designed, end-to-end. Multi-brand isolation can spill to Day 7 AM.**

## This week (Week 1 — rest of)

- ~~Day 4 (Sat 2026-05-02): Writer + Editor + Spanish + QG + grounding-wired end-to-end.~~ ✅
- ~~Day 5 (Sat 2026-05-02): Notion sync.~~ ✅ minimum done
- Day 6 (Sun 2026-05-03): Designer port + multi-brand isolation test.

## Next week (Week 2)

- Day 6 (Mon): Multi-brand testing (3 brands isolated, no cross-brand leakage).
- Day 7 (Tue AM): Onboarding CLI. **PM:** Hashtag IG token rotation atomic session per D-011.
- Day 8 (Wed): Per-brand publishing (Node-side IG publish or hand-off-to-Publisher-A6).
- Day 9 (Thu): Reliability hardening — retry+timeout+circuit-breaker per external call, runbook.
- Day 10 (Fri): E2E validation + first real brand onboarded.

## Open questions (need answer before relevant day)

- **Day 4 — RESOLVED:** Sonnet 4.6 across all chain steps for MVP (consistency > per-step optimization). Day 9 cost review will split if telemetry justifies it.
- **Day 4 — RESOLVED:** 1 Writer revision attempt for pre-Phase-A grounding revise; same for Phase A revise. Both budgets exercised live without runaway cost.
- **Day 5 — RESOLVED:** Reused existing Hashtag Notion token (broad scope, inherited from n8n). Day 9 cleanup task: migrate to dedicated read-only `content-agency-mvp-sync` integration scoped to the 8 shared agency DBs.
- **Day 7 PM:** Maria's availability for first onboarding rehearsal? (target: Day 10 afternoon).
- **Day 10:** Which real brand is #1? (decide by end of Week 1).
- **Backport task (not blocking):** any past `failure_category=thin_source` content_queue page with comma-separated numbers in source — replay through new chain to recover. Out of MVP scope; nice-to-have post-Day-10.

## Backlog (not in MVP, capture so we don't forget)

- LinkedIn integration (weeks 3-4).
- Learning loop: top-20% performers → few-shot examples (weeks 5-6).
- Admin app for Ivan/Maria (single-pane control surface) (weeks 5-6).
- Per-brand custom-domain webhooks (post-MVP).
- Analytics dashboard for Ivan (weeks 7-8).
- KMS for `MASTER_ENCRYPTION_KEY` (post-MVP per D-008).
- `supabase gen types typescript` to replace hand-rolled `src/db/types.ts` (Day 9+).
- Bump `@anthropic-ai/sdk` past 0.32 to get typed `cache_creation_input_tokens` / `cache_read_input_tokens` (currently cast through `unknown`).
- **Cleanup task in n8n: remove plaintext API keys from Strategist/Writer/Editor Config nodes** (currently hardcoded as literals; should be in n8n credentials). Surfaced this session, not fixed yet — separate atomic session.
- **Day 9 cleanup: dedicated read-only `content-agency-mvp-sync` Notion integration** scoped to the 8 shared agency DBs. Replaces the inherited Hashtag token currently in `NOTION_API_KEY`. Clean revoke path; principle of least privilege.
- **Day 9 reliability: Postgres advisory lock around the 5-min sync scheduler** so multi-replica Railway deploys don't race. Today the scheduler is single-replica only; documented in D-014.

## Decision-log triggers (add D-### to DECISIONS.md if any of these come up)

- Switching from Supabase to self-hosted Postgres.
- Adding a non-Notion creative-control surface.
- Changing from Railway to another deploy target.
- Adding cross-brand data sharing.
- Skipping prompt caching.
- Bypassing the per-brand circuit breaker pattern.
- Reading brand identity directly from Notion at pipeline-time (would supersede D-010).
- Re-introducing re-fetch-and-re-normalize grounding architecture (would supersede D-013).
- Splitting models per chain step (e.g. Haiku for Spanish Editor) — should be evidence-based on Day 9 cost telemetry.
