# TODO — content_agency_mvp

> Session-level next-actions. Updates every session.
> For the locked 14-day plan, see `PLAN.md`.

## Day 1 — ✅ DONE (2026-04-30 late-night)
## Day 2 — ✅ DONE (2026-05-01)
## Day 3 first iteration — ✅ DONE (2026-05-02 CST)

All Day 3 foundation steps complete. See SESSION_LOG.md Session 3 for full trace.

## Right now (Day 4 — Writer + Editor + grounding wired end-to-end)

1. [ ] Create `src/pipeline/strategist.ts` — deterministic strategy-decision. Inputs: brand_identity + extracted claims + anchor_weight. Logic:
   - Pick pillar by heuristic topic-match against `brand_identity.pillars[].name + .example_topics + .description` (token overlap → highest-scoring pillar wins).
   - Pick recipe from intersection of `pillar.preferred_recipes[]` and recipes eligible for `anchor_weight.tier` (data-rich → Death-Data eligible; narrative-thin → Punch-Single only; opinion-only → Identity-Confront).
   - Pick hook template from `brand_identity.hooks[]` matching `recipe.engagement_trigger`.
   - Pick CTA from `brand_identity.ctas[]` matching `pillar.short_code` (e.g. AI•Save for AI pillar).
   - Compose `brief` (one sentence summarizing the angle).
   - Output: `Strategy` object with all the fields Writer expects.
   - Pure Node, no LLM. ~150 LOC.

2. [ ] Create `src/pipeline/writer.ts` — first LLM-author step. Port the n8n Writer system prompt verbatim from this session's tool-results dump (`mcp-n8n-mcp-n8n_get_workflow-1777668912934.txt` / "Build Writer Prompt" node, ~250 LOC of prompt). Parameterize by `brand_identity + extracted_claims + strategy`. Use `complete()` from `lib/anthropic.ts` with `step: 'writer'` for Sentry telemetry. Returns `{caption, slides, format}`. ~200 LOC including parsing + retry on JSON parse failure.

3. [ ] Wire `verifyDraftGrounding()` between Writer and Editor. Slice the draft into labeled regions (caption, slide_N_headline, slide_N_body, slide_N_accent, data_card numbers). Pass to grounding fn. Verdict:
   - `pass` → continue to Editor.
   - `revise` → re-prompt Writer with offending[] list (1 attempt, then hand to QG Phase A).
   - `kill` → mark post_queue.status = 'failed', failure_category='grounding_pre_a'.

4. [ ] Port Editor Rules A+C+D from n8n (workflow `WV8ZxfKnLllJjcRl`, "Editor: Rules A+C+D" node). Already captured in this session's MCP dump. ~120 LOC.

5. [ ] Port Spanish Editor from n8n (workflow `2IrMf52AqP6sqgjg`). The 4KB system prompt is the value here — it's hard-won linguistic knowledge. ~80 LOC + the prompt.

6. [ ] Port QG Phase A from n8n (workflow `ulIyyThcE1jLOJ1W`, "Fact Check Phase A" node). LLM verifier sends draft + anchor_claims to Sonnet, returns pass/revise/kill. Reuse the verdict shape we already have. ~150 LOC.

7. [ ] Persist `PostEnvelope` to `post_queue` at every step boundary. Use `enqueuePost` (idempotent on brand_id + idempotency_key) at /run-pipeline entry, then `updatePostStatus` with `payloadPatch` at each step transition. Status enum already in 0001_init.sql.

8. [ ] Extend `POST /run-pipeline` to run the FULL chain end-to-end. Body unchanged. Response: full PostEnvelope + final status.

9. [ ] **Smoke test:** same Stack Overflow source → through full chain → produces a real draft that passes Phase A. This is the negative-image test of BUG-S58-5 — proves the new architecture not only avoids the bug but ships the post the old architecture wrongly killed.

10. [ ] If the smoke test ships clean, persist the result to `post_results` (mark as test, not real publish). Then we have a full Day 4 end-to-end working artifact.

**Day 4 done = `/run-pipeline` runs Brand 0 + Stack Overflow Survey through the full chain to status=ready, draft cites "65,000" correctly anchored, PostEnvelope persisted in post_queue, no false-positive grounding kill.**

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

- **Day 4:** Use Sonnet 4.6 (`claude-sonnet-4-6`) for ALL chain steps in MVP, or Haiku for lighter steps (Editor/Spanish Editor/QG)? Default plan: Sonnet across the board for consistency; revisit on Day 9 cost review.
- **Day 4:** When pre-Phase-A grounding says "revise", how many Writer revision attempts before handing to QG Phase A? Default: 1 (matches existing n8n behavior).
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
- Re-introducing re-fetch-and-re-normalize grounding architecture (would supersede D-012).
