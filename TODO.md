# TODO — content_agency_mvp

> Session-level next-actions. Updates every session.
> For the locked 14-day plan, see `PLAN.md`.

## Day 1 — ✅ DONE (2026-04-30 late-night)
## Day 2 — ✅ DONE (2026-05-01)
## Day 3 first iteration — ✅ DONE (2026-05-02 CST)
## Day 4 — ✅ DONE (2026-05-02 CST)

Full text-side chain shipped. Stack Overflow Survey 2024 source produces 33-number, 0-unanchored, 10-slide draft reaching `status=ready` in 113s. See SESSION_LOG.md Session 4 for full trace.

Architecture pivot during Day 4: Strategist is an LLM call (not deterministic Node) — Session 3's misread corrected. D-013 logged: pre-Phase-A grounding is two-tier (claims set + source_text fallback) preserving D-012's single-normalize win while handling the top-N extraction cap.

## Right now (Day 5 — Notion sync + Designer)

1. [ ] Create `src/sync/notion-brand.ts` — read the 9 brand DBs filtered to Client=<brand>, upsert `brand_identity` jsonb via `upsertBrandIdentity()`. Each DB queried with `filter: { property: "Client", select: { equals: <brand_name> } }` so we don't fight the substring search bug from Day 2. Output shape matches `BrandIdentity` interface in `db/types.ts` — categories: themes, pillars, image_rules, blueprints, recipes, ctas, hooks, lexicon, photo. Pure Node, ~250 LOC.

2. [ ] Cron-style scheduling — every 5 min, refresh all `active`/`onboarding` brands. Use `setInterval` with skew-and-jitter to avoid thundering herd. Skip if last sync was <2 min ago. ~50 LOC.

3. [ ] `POST /admin/refresh-brand/:slug` endpoint — on-demand sync trigger. Returns the count of rows synced per category + the new `brand_identity_synced_at` timestamp. ~30 LOC.

4. [ ] **Verify Hashtag's full identity populates from Notion** — should pull all ~45 rows (1 theme + 3 pillars + 4 image_rules + 1 blueprint + 6 recipes + 15 ctas + 12 hooks + 2 lexicon + 1 photo).

5. [ ] **Re-run Day 4 smoke** with FULL identity loaded — confirm Strategist now picks REAL pillar/recipe/hook/CTA names from the synced Hashtag identity (not Sonnet-improvised names like `IDENTITY_CONFRONT — data-rich edition` from the partial-Brand-0 run).

6. [ ] Begin Designer port — HCTI + Gemini + GCS + GDrive rendering chain from CD v3 archived workflow `mUbLOTYjNCl776AT` (canonical) or already-shipped Designer A4 (`8KYkBaKg3yeRummd`). Designer consumes the `WriterDraft` from `post_queue.payload` (status=ready) → produces slide image URLs → advances `status` to `designed`. Day 5 may not finish all of Designer; if not, the priority is Notion sync + verified resync, with Designer carrying into Day 5 PM or Day 6 AM.

**Day 5 done minimum = Hashtag identity fully synced from Notion + Day-4 smoke re-runs with REAL pillar/recipe/hook/CTA names. Designer port can spill to Day 6.**

## This week (Week 1 — rest of)

- Day 4 (Sat 2026-05-02): Writer + Editor + Spanish + QG + grounding-wired end-to-end.
- Day 5 (Sun-Mon): Notion sync — `src/sync/notion-brand.ts` reads 9 DBs filtered to Client=<brand>, upserts brand_identity. Cron 5-min loop. `POST /admin/refresh-brand/:slug` endpoint. Verify Hashtag's full identity populates from Notion.

## Next week (Week 2)

- Day 6 (Mon): Multi-brand testing (3 brands isolated, no cross-brand leakage).
- Day 7 (Tue AM): Onboarding CLI. **PM:** Hashtag IG token rotation atomic session per D-011.
- Day 8 (Wed): Per-brand publishing (Node-side IG publish or hand-off-to-Publisher-A6).
- Day 9 (Thu): Reliability hardening — retry+timeout+circuit-breaker per external call, runbook.
- Day 10 (Fri): E2E validation + first real brand onboarded.

## Open questions (need answer before relevant day)

- **Day 4 — RESOLVED:** Sonnet 4.6 across all chain steps for MVP (consistency > per-step optimization). Day 9 cost review will split if telemetry justifies it.
- **Day 4 — RESOLVED:** 1 Writer revision attempt for pre-Phase-A grounding revise; same for Phase A revise. Both budgets exercised live without runaway cost.
- **Day 5:** Notion API token — generate a new Notion integration scoped to the 9 brand DBs (and the Strategy parent page), or reuse existing one? Default: new dedicated integration `content-agency-mvp-sync` for clean revoke path.
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
