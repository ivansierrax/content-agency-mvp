# TODO — content_agency_mvp

> Session-level next-actions. Updates every session.
> For the locked 14-day plan, see `PLAN.md`.

## Day 1 — ✅ DONE (2026-04-30 late-night)
## Day 2 — ✅ DONE (2026-05-01)
## Day 3 first iteration — ✅ DONE (2026-05-02 CST)
## Day 4 — ✅ DONE (2026-05-02 CST)
## Day 5 (minimum) — ✅ DONE (2026-05-02 CST)
## Day 6 — ✅ DONE (2026-05-02 CST)

Designer port shipped. Stack Overflow Survey 2024 source produces a 7-slide rendered carousel with public Supabase Storage URLs in 165s end-to-end. Phase A revise loop exercised live for the first time and recovered cleanly. All 6 slide types render correctly: typography_dark, typography_light, person_photo (Gemini portrait), data_card, object_photo (Gemini scene), closing_cta. See SESSION_LOG.md Session 6 for full trace + slide samples.

D-015 logged: Supabase Storage chosen over production's GDrive for auth simplicity + IG-publish friendliness + no new infra.

Multi-brand isolation test deferred to Day 7 AM (Designer was the bigger lift; senior call to ship Designer cleanly rather than rush isolation work).

## Right now (Day 7 — Multi-brand isolation + onboarding CLI + Hashtag IG token rotation)

1. [ ] **Multi-brand isolation test (Day 6 deferred):** insert synthetic Brand 1 via direct Postgres INSERT — `slug='testbrand'`, `name='Test Brand'`, `status='onboarding'` + `brand_configs` row with `notion_client_filter='TestClient'` (a string that doesn't exist as a `Client` select option in any of the 8 Hashtag DBs). Trigger `POST /admin/refresh-brand/testbrand` — should return 0 rows in every category. Then `POST /run-pipeline` for Brand 1 with the SO Survey source — should either (a) fail loudly because Strategist can't pick from empty pillars, or (b) run with Sonnet-improvised names. Verify Brand 1's chosen names + IDs are NOT Brand 0's. Document the outcome.

2. [ ] **Onboarding CLI (`scripts/onboard-brand.ts` or `npm run onboard`):** ~150 LOC. Inputs: brand slug, brand name, notion_client_filter, optional ig_business_account_id. Steps: insert `brands` row → insert `brand_configs` row with the filter set → POST to local `/admin/refresh-brand/:slug` to trigger first sync → report counts + warnings. Replaces the manual `INSERT INTO` dance. Day 7 PM token-rotation step uses this same CLI.

3. [ ] **Hashtag IG token rotation (atomic session per D-011):** OAuth dance via Graph API Explorer to mint a fresh 60-day Page-token. Encrypt with `MASTER_ENCRYPTION_KEY` via `src/lib/crypto.ts`. Write to `brand_configs.ig_token_encrypted` for Brand 0. Verify with a `debug_token` Graph API call (must show `is_valid:true`, `expires_at:60-days-out`, `scopes:[pages_show_list,...]`). Log rotation in CREDENTIALS.md.

4. [ ] **Day 8 prep notes** — scan `engineering_decisions.md` for IG-publish gotchas already documented (BUG-S58-4, anti-spam throttle, carousel-vs-single ordering rules). Queue Day 8 work items.

**Day 7 done minimum = isolation test documented + onboarding CLI works + Hashtag IG token rotated to fresh 60-day. Day 8 builds publish path on top.**

## This week (Week 1 — rest of)

- ~~Day 4 (Sat 2026-05-02): Writer + Editor + Spanish + QG + grounding-wired end-to-end.~~ ✅
- ~~Day 5 (Sat 2026-05-02): Notion sync.~~ ✅ minimum done
- ~~Day 6 (Sat 2026-05-02): Designer port.~~ ✅ done; multi-brand isolation deferred to Day 7

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
