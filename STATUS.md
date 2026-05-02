# STATUS — content_agency_mvp

**Day 3 first iteration (2026-05-01 → 2026-05-02 CST) — ✅ DONE. Anthropic SDK wrapper + claim extraction with substring verifier + grounding check live. Smoke test passes against the source that BUG-S58-5 historically false-killed.**

## Where we are

End of Day 3 first iteration. The Node service has:
- A working data layer (Day 2: 5 tables, Brand 0 seeded, /health surfaces it).
- Anthropic SDK wrapper with prompt caching (40% latency drop on cached calls verified live).
- Claim extraction with **substring verifier** (D-008/D-012 — Sonnet-side hallucination defense).
- Grounding check that operates on `anchor_claims` membership, not re-fetched source text — BUG-S58-5 cannot recur in this code by construction.
- `POST /run-pipeline` smoke endpoint live.
- The historical Stack Overflow false-kill source replayed end-to-end through the new chain — `65,000` is correctly anchored, `dropped: []`, `status: ok`.

Day 4 layers Writer (the first LLM-author step) + Phase A grounding gate + Editor/Spanish/QG.

## What we have

- ✅ Day 1 done (HTTP server, Sentry verified — Session 1.5).
- ✅ Day 2 done (data layer, Brand 0 seeded — Session 2).
- ✅ **Day 3 first iteration (Session 3):**
  - `src/lib/anthropic.ts` — SDK wrapper with prompt caching (`cache_control: ephemeral`), Sentry breadcrumbs per call (cache_hit_rate, tokens, elapsed_ms, step, brand_slug). `parseModelJson` helper handles fence-stripping + substring fallback.
  - `src/pipeline/types.ts` — `PostEnvelope` shape, `AnchorClaims`, `ExtractionResult`. Each chain step appends its own slice.
  - `src/pipeline/extract_claims.ts` — Jina fetch → bot-block detection → LLM extraction (verbatim port of n8n prompt) → **substring verifier** → tier reclassification on verified counts → thin-source gate.
  - `src/pipeline/grounding.ts` — `verifyDraftGrounding()` checks draft numbers against `anchor_claims.numeric_claims[].value` membership. SINGLE normalize fn used both sides. Verdict: pass / revise / kill.
  - `src/index.ts` — `POST /run-pipeline` smoke endpoint (extraction-only for Day 3; Day 4 will extend through write+ground+edit).
- ✅ Decisions logged D-008 → D-012 (D-008 AES, D-009 jsonb, D-010 sync, D-011 token defer, D-012 grounding-on-anchor-claims).
- ✅ Production n8n QG patched in-flight: BUG-S58-5 fixed in workflow `ulIyyThcE1jLOJ1W` (asymmetric normalization → symmetric `corpusDigits`). Logged to `content_pipeline/KNOWN_ISSUES.md`.

## What we don't have yet (Day 4+)

- ⚪ **Strategist's strategy-decision step** (Node deterministic — pick pillar/recipe/hook/CTA from brand_identity + extracted claims). Day 4.
- ⚪ **Writer** (first LLM-author agent — port n8n's Writer system prompt verbatim, parameterize by brand_identity + claims + strategy). Day 4.
- ⚪ **Pre-Phase-A grounding wired** (call `verifyDraftGrounding()` between Writer and Editor). Day 4.
- ⚪ **Editor + Spanish Editor + QG Phase A LLM** (port from n8n). Day 4.
- ⚪ **post_queue persistence** at every step boundary (currently /run-pipeline returns ExtractionResult inline; needs to insert + update_status). Day 4.
- ⚪ **Designer** (HCTI + Gemini + GCS + GDrive port). Day 5.
- ⚪ **Notion sync** — pull all 9 DBs filtered to Client=<brand>, upsert brand_identity. Day 5 — D-010.
- ⚪ Multi-brand testing, onboarding CLI, token rotation Day 7, per-brand publishing Day 8, reliability Day 9, E2E + first real brand Day 10.

## Health

| Component | Status |
|---|---|
| Plan | 🟢 |
| Architecture | 🟢 12 active decisions logged (D-001 through D-012) |
| Code | 🟢 data layer + extraction + grounding live, typecheck clean |
| Infrastructure | 🟢 Railway → Sentry → Supabase → Anthropic |
| Brand 0 seeded | 🟢 partial (Day 5 sync completes the rest) |
| First extraction live + verified | 🟢 (Stack Overflow source — historical false-kill — now passes) |
| First full draft | ⚪ Day 4 target |
| First real brand onboarded | ⚪ Day 10 target |
| Live with paying brand | ⚪ Day 11-14 target |

## Current blockers

None.

## Last session

**2026-05-01 → 2026-05-02 CST (Session 3 — Day 3 first iteration DONE + BUG-S58-5 production fix):**

Started Day 3 with the planned Strategist port. **Pulled Strategist + Writer + Editor + Spanish Editor + QG full code from n8n via MCP** to read the existing chain in detail before porting. Discovery sequence:

1. **Strategist is NOT an LLM agent** — it's deterministic Node code: scout topic → fetch source → extract claims → pick pillar/recipe → assemble Context Package → trigger Writer (the first LLM step). Reframed Day 3 plan accordingly.

2. **The existing chain has GOOD grounding architecture** — Writer has 5 explicit grounding rules, Editor defers fact-check to QG, QG has revise-then-kill loop with Anchor-Pinned Corrector. My initial "redesign the contract" instinct was wrong; the contract is sound.

3. **But fabrication failures still ship.** Read the actual claim-extraction code: it's Sonnet with strict "verbatim only" prompt, but **never mechanically verifies extracted claims appear in source**. Hypothesized this was the root cause.

4. **Validation pass against historical kills.** Pulled SMOKE-S56-01 (Stack Overflow Survey kill, `failure_category=thin_source`). Trace: source HAD "65,000 developers", Sonnet extracted `numeric_claims: [{value: "65,000"}]` correctly, Writer cited "65,000" correctly. **Then the QG pre-flight grounding check flagged `caption:65,000 | body:65,000` as fabricated.** Corrector replaced with "masivamente". Phase A correctly killed "masivamente" as unanchored. failure_category="thin_source" — wildly misleading. So my "extractor hallucinates" hypothesis was wrong on this case; the bug is downstream.

5. **Read QG's "Extract Reviews" code → found BUG-S58-5.** Asymmetric normalization: corpus replaces `,` with space (`"65,000"` → `"65 000"`), needle strips `,` entirely (`"65,000"` → `"65000"`). `corpus.includes(needle)` never matches for ≥1000 numbers with thousand-separator commas. Years pass through; thousands die.

6. **Patched live n8n QG via `n8n_update_partial_workflow`** with single-line fix (`corpusDigits` parallel to corpus, used in the membership check). Workflow stayed `active:true`. Verified patch landed.

7. **Logged BUG-S58-5 to content_pipeline/KNOWN_ISSUES.md** with full trace, root cause code excerpt, fix shipped, prevention rule, triage note (any past `failure_category=thin_source` page with comma-separated numbers in source is suspect).

8. **D-012 captured the broader lesson** for the new service: don't carry forward the re-fetch-and-re-normalize architecture; check against `anchor_claims` directly. Two normalize fns will drift again under future edits.

9. **Built Day 3 modules.** All operating on the D-012 contract:
   - `anthropic.ts` with prompt caching + cache_hit_rate telemetry
   - `extract_claims.ts` with substring verifier (D-008 — drops Sonnet hallucinations before they become anchored)
   - `grounding.ts` with single-normalize anchor membership (D-012 — BUG-S58-5 immune by construction)
   - `/run-pipeline` smoke endpoint

10. **Live smoke test against the historical false-kill source.** Stack Overflow Survey URL → extraction returns `{numeric_claims: [{value: "65,000", context: "polled more than 65,000 developers..."}], dropped: [], tier: "narrative-strong", status: "ok"}`. The number n8n killed is now an anchored claim. Day 4 grounding check will pass it mechanically.

11. **Caching verified live.** Same source second call: 8.1s → 4.8s (~40% latency drop). System prompt caching works as designed. Sentry breadcrumbs have the precise rate.

**What's next:**
- Day 4: layer Strategist's strategy-decision (Node) + Writer (LLM, port from n8n) + pre-Phase-A grounding wired + Editor + Spanish + QG Phase A LLM.
- Resume next session with `[MVP] resume`.

**Blockers:** None.

**New decisions logged:** D-012 (grounding on anchor_claims, not re-normalized source).

**External state changes this session:**
- n8n: workflow `ulIyyThcE1jLOJ1W` patched (BUG-S58-5 single-line fix, still `active:true`).
- GitHub: 5 commits on main (state close + 0001 migration + 0002 + code modules + Day 3 foundation + D-012 + Day 3 build).
- Railway: 2 deploys (after MASTER_ENCRYPTION_KEY set + after Day 3 push). Both ACTIVE, /health 200.
- Anthropic: ~10 inference calls during smoke testing (~2K input + ~1K output tokens each — total <30K tokens, negligible cost).
- Supabase: no schema changes this session (Day 2's 0001 + 0002 already applied).

**Live verification:**
- ✅ `POST /run-pipeline` returns valid ExtractionResult with verifier active.
- ✅ Historical false-kill source produces verified `65,000` anchor claim — proves the new architecture catches what the old one couldn't.
- ✅ Prompt cache hit on 2nd call — 40% latency drop confirms caching works.

## Next session

**Day 4 — Writer + Editor + grounding wired end-to-end.** Resume with `[MVP] resume`. First actions:
1. Build `src/pipeline/strategist.ts` — deterministic strategy-decision (pick pillar from brand_identity.pillars by heuristic match against topic; pick recipe from `anchor_weight.tier` + `pillar.preferred_recipes`; pick hook template + CTA from anchor lists). Pure Node, no LLM.
2. Build `src/pipeline/writer.ts` — port the n8n Writer system prompt verbatim (already captured in this session's tool-results dump). Parameterize by brand_identity + extracted claims + strategy. Returns `{caption, slides, format}`.
3. Wire `verifyDraftGrounding()` between Writer and Editor. Verdict revise → re-prompt Writer with offending list (1 attempt, then hand to QG Phase A).
4. Port Editor (Rules A+C+D) + Spanish Editor + QG Phase A from n8n (all already captured in tool-results dumps).
5. Persist `PostEnvelope` to `post_queue` at every step boundary (status transitions: pending → strategist → writer → editor → spanish_editor → qg → ready).
6. Extend `/run-pipeline` to run the FULL chain end-to-end, not just extraction.
7. Smoke test: same Stack Overflow source → through full chain → produces a real draft that passes grounding (the negative-image test of BUG-S58-5).
