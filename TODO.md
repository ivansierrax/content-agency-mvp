# TODO — content_agency_mvp

> Session-level next-actions. Updates every session.
> For the locked 14-day plan, see `PLAN.md`.

## Day 1 — ✅ DONE (2026-04-30 late-night)
## Day 2 — ✅ DONE (2026-05-01)
## Day 3 first iteration — ✅ DONE (2026-05-02 CST)
## Day 4 — ✅ DONE (2026-05-02 CST)
## Day 5 (minimum) — ✅ DONE (2026-05-02 CST)
## Day 6 — ✅ DONE (2026-05-02 CST)
## Day 7 (automatable portion) — ✅ DONE (2026-05-02 CST)

Multi-brand isolation verified clean for creative inventory (Brand 1 with empty identity ran end-to-end, Strategist picked Sonnet-improvised names, all Postgres IDs null — no Brand 0 leak). Onboarding CLI + token-store CLI shipped and tested both happy + failure paths. IG token rotation runbook written. Architectural finding logged: Notion data_sources query rejects unknown `Client` select options with HTTP 400 — onboarding CLI's preflight catches this. Soft theme-leak (Hashtag-hardcoded fallback) logged for Day 9.

Day 7 PM IG token rotation itself is **BLOCKED on Ivan** running the runbook (manual OAuth + MFA, ~15-20 min). Verification agent `trig_017kbLj7ju1Q8Aq7d2WBh5c8` fires 2026-05-09 09:00 CST and will alarm if not done.

## Right now (Day 8 — IG Graph API publishing path)

**HARD PRECONDITION:** Hashtag IG token rotation complete. Run `runbooks/ig-token-rotation.md` first.

1. [ ] Read `engineering_decisions.md` IG-publish patterns. Specifically:
   - BUG-S58-4 (silent token expiry → daily debug_token check required)
   - Anti-spam throttle (≤5 publish probes/account/hour during dev)
   - Carousel-vs-single ordering rules (n8n Publisher A6 has these)
   - Dual-account routing (BUG-S58-1 fix already in workflow `8jSmVKk7ezw1s5No`)

2. [ ] Build `src/pipeline/publisher.ts` (~250 LOC):
   - Input: `post_queue` row at `status='ready'` with all slide URLs populated.
   - For each slide URL: `POST /<ig_business_account>/media` (children), collect `id` of each.
   - `POST /<ig_business_account>/media` (parent carousel container, `media_type=CAROUSEL`, `children=[...]`).
   - Poll status of parent container until `FINISHED` (anti-spam: <5 polls/min/account).
   - `POST /<ig_business_account>/media_publish?creation_id=<parent_id>`.
   - INSERT into `post_results` with `ig_media_id`, `ig_permalink`, `published_at`. Use existing `recordPublishSuccess()`.
   - Status flow: `ready → publishing → published`. Failure → `published_attempts++`, `last_error`, retry on next cron tick.

3. [ ] Add Day 8 cron in `src/sync/scheduler.ts` or new `src/publish/scheduler.ts`: every 5 min, poll `post_queue` for `status='ready' AND scheduled_for <= now()`, kick off publisher per row. Sequential per brand (anti-spam), parallel across brands.

4. [ ] Add `POST /admin/publish/:post_queue_id` endpoint for on-demand publish (mirrors /admin/refresh-brand pattern).

5. [ ] Smoke test: take the Day-6 Stack Overflow `post_queue_id` (`cab31b62-4b0b-4e95-b2d2-4e1feeba3840`), update `scheduled_for` to NOW(), trigger publisher, verify it publishes to `@agenciahashtag_` (or per dual-account routing).

**Day 8 done = `/run-pipeline` produces a draft → cron picks it up at scheduled_for → publishes to IG → post_results row written with permalink. End-to-end live publish for Brand 0.**

## This week (Week 1 — rest of)

- ~~Day 4 (Sat 2026-05-02): Writer + Editor + Spanish + QG + grounding-wired end-to-end.~~ ✅
- ~~Day 5 (Sat 2026-05-02): Notion sync.~~ ✅ minimum done
- ~~Day 6 (Sat 2026-05-02): Designer port.~~ ✅ done; multi-brand isolation deferred to Day 7
- ~~Day 7 (Sat 2026-05-02): isolation + CLIs + runbook.~~ ✅ automatable portion done; rotation blocked on Ivan

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
- **Day 9 reliability: brand-correct theme fallback** when `brand_identity.themes` is empty. Today the fallback in `pickThemeColors()` (`src/pipeline/designer.ts`) hardcodes Hashtag's red/black + `HASHTAG AGENCIA` footer + `ivan@hashtag.com.mx`. Surfaced by Day 7 isolation test — Brand 1's slides showed Hashtag branding visually despite clean creative-inventory isolation. Fix: use `brand.name` for footer + neutral-default colors when no theme row exists.
- **Day 9 reliability: recurring monthly IG-token verification agent.** The one-time agent on 2026-05-09 (`trig_017kbLj7ju1Q8Aq7d2WBh5c8`) catches Day 7 PM rotation. For ongoing operation, schedule a recurring monthly cron-based agent that runs `debug_token` for every active brand's encrypted token and alarms if any expire in <10 days. Cadence: 1st of each month, 9am CST.
- **Test brand cleanup:** `testbrand` (id=`ace4d401-f56f-4b02-a55c-5250be0d1c89`) is archived but rows persist in `brands`, `brand_configs`, `post_queue` (1 row from isolation test). Safe to leave for forensic value; consider hard-delete once 90+ days post-MVP-launch.

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
