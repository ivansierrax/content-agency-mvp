# STATUS — content_agency_mvp

**Day 4 (2026-05-02 CST) — ✅ DONE. Full chain end-to-end verified live: extract → strategize → write → ground → edit → spanish → QG Phase A → `status='ready'`. Stack Overflow Survey 2024 source produced 33-number, 0-unanchored, 10-slide draft in 113s.**

## Where we are

End of Day 4. The Node service has the **full text-side pipeline** running:

- ✅ Extraction with substring verifier (D-008/D-012, Day 3).
- ✅ Strategist as a single LLM call (single-topic port of n8n's Strategy Decision) — pillar / engagement_trigger / recipe / hook / CTA / brief / anchor_claims subset / object_concept.
- ✅ Context Package assembly (deterministic Node).
- ✅ Writer (single LLM call, verbatim port of n8n Writer prompt + structural validator).
- ✅ Pre-Phase-A grounding — two-tier (claims set + source_text fallback), single normalize fn (D-013, supersedes D-012's narrower interpretation).
- ✅ Writer rewrite path with grounding feedback (1-attempt budget).
- ✅ Editor Rules A+C+D (LLM, with CTA-immutable enforcement).
- ✅ Spanish Editor (LLM, with length-ratio + double-accent safeguards).
- ✅ QG Phase A semantic verifier (LLM, anchor_claims contract).
- ✅ Phase A revise path → Writer rewrite + Editor + Spanish + Phase A retry (1-attempt budget).
- ✅ post_queue persisted at every step boundary; final `status='ready'` reached.
- ✅ `/run-pipeline` HTTP endpoint runs full chain end-to-end. Backward-compatible `mode=extract_only` for Day 3 smoke parity.

Day 5 picks up Notion sync + Designer.

## What we have

- ✅ Day 1 (HTTP server, Sentry — Session 1.5).
- ✅ Day 2 (data layer, Brand 0 — Session 2).
- ✅ Day 3 first iteration (extraction + grounding modules — Session 3).
- ✅ **Day 4 (full text-side chain — Session 4):**
  - `src/pipeline/strategist.ts` — single-topic LLM port + Context Package assembly. Defensively handles partial Brand 0 identity.
  - `src/pipeline/writer.ts` — verbatim Writer prompt port + fresh/rewrite modes + structural validator + Rule [F] accent_text-substring auto-patch.
  - `src/pipeline/editor.ts` — Rules A+C+D LLM + CTA-immutable enforcement (closing_cta + caption-tail line restored from original draft on revise).
  - `src/pipeline/spanish_editor.ts` — Mexican-Spanish LLM + length-ratio gate + double-accent revert.
  - `src/pipeline/qg_phase_a.ts` — LLM verifier against anchor_claims; verdicts pass/revise/kill.
  - `src/pipeline/chain.ts` — orchestrator wiring all steps, persistence at every boundary, two revise budgets (pre-Phase-A grounding + Phase A LLM).
  - `src/index.ts` — `/run-pipeline` extended; `mode=extract_only` retained.
  - Two-tier grounding (`extract_claims.ts` exposes `source_text`; `grounding.ts` accepts it as tier-2 corpus).
  - D-013 logged.

## What we don't have yet (Day 5+)

- ⚪ **Notion sync** — `src/sync/notion-brand.ts` reads 9 DBs filtered to Client=<brand>, upserts `brand_identity` jsonb. 5-min cron loop + `POST /admin/refresh-brand/:slug`. Day 5.
- ⚪ **Designer** — port HCTI + Gemini + GCS + GDrive rendering chain from CD v3 (workflow `8KYkBaKg3yeRummd`). Day 5.
- ⚪ **Multi-brand testing** (3 brands isolated, no cross-brand leakage) Day 6.
- ⚪ **Onboarding CLI** Day 7 AM. **Hashtag IG token rotation** atomic session Day 7 PM.
- ⚪ **Per-brand publishing** (Node-side IG publish or hand-off to Publisher A6) Day 8.
- ⚪ **Reliability hardening** Day 9.
- ⚪ **E2E + first real brand onboarded** Day 10.

## Health

| Component | Status |
|---|---|
| Plan | 🟢 |
| Architecture | 🟢 13 active decisions logged (D-001 through D-013) |
| Code | 🟢 full chain live, typecheck clean |
| Infrastructure | 🟢 Railway → Sentry → Supabase → Anthropic |
| Brand 0 seeded | 🟢 partial (Day 5 sync completes the rest) |
| First extraction live + verified | 🟢 (Day 3) |
| First full draft reaching `status=ready` | 🟢 (Day 4 — Stack Overflow Survey 2024) |
| First real brand onboarded | ⚪ Day 10 target |
| Live with paying brand | ⚪ Day 11-14 target |

## Current blockers

None.

## Last session

**2026-05-02 CST (Session 4 — Day 4 DONE, full chain live):**

Built and shipped the entire text-side chain in one session. Highlights below; full trace in SESSION_LOG.md.

1. **Pulled all five n8n workflows via MCP** (Strategist + Writer + Editor + Spanish Editor + QG v2). Read the actual code, not the docs.
2. **Architecture pivot — Strategist IS an LLM agent.** Session 3's "deterministic Node" reading was wrong; the real `Strategy Decision` node is a Sonnet call with a 100+ line prompt. Reframed Day 4 plan, flagged the pivot to Ivan, ported faithfully.
3. **Built Strategist + Writer + Editor + Spanish + QG Phase A + chain.ts orchestrator** — six new modules, ~2100 LOC. Verbatim prompts ported from n8n where they exist; new code only for Node-side wiring.
4. **Single LLM provider (Sonnet 4.6) across all chain steps for MVP consistency** — confirmed with Ivan; Day 9 cost review can split per-step models on real telemetry.
5. **First smoke test failed** (`status=failed`, `failure_category=thin_source`) — Stack Overflow blog URL had moved (404). Switched to live URL `survey.stackoverflow.co/2024/`.
6. **Second smoke surfaced a contract bug:** Writer cited `185 países`, `70% (year ago)`, `44%` — real source numbers but outside Strategist's curated anchor subset. Pre-Phase-A grounding killed legitimately grounded content.
7. **D-013 — two-tier grounding.** Day 3's grounding (D-012) only checked Strategist's curated `anchor_claims`. Real source numbers outside the top-15 extraction cap got flagged as fabricated. Fix: tier-1 = full extraction set; tier-2 = full `source_text` substring fallback. Same single normalize fn on both sides → BUG-S58-5 stays structurally impossible. Verified live: 33 numbers in draft, all 33 anchored.
8. **`writer_grounding_rewrite` path exercised live** — first Writer pass had grounding misses on a few numbers; rewrite (with feedback list) recovered cleanly. Telemetry shows 28s + 26s = 54s of writing total for a clean post.
9. **Final live verification:** `POST /run-pipeline` against Stack Overflow Survey 2024 source returns:
   - `status=ready` in 113s
   - 10-slide carousel, 33 numbers in draft, 0 unanchored, QG Phase A passes in 2.4s
   - `post_queue` row persisted: `cab31b62-4b0b-4e95-b2d2-4e1feeba3840`, `status=ready`, `status_reason=pipeline_text_ready`
   - Caption opens: *"El costo real de ignorar 65,000 respuestas es tomar decisiones con el mapa equivocado."* — 65,000 directly from anchor (the BUG-S58-5 negative-image test).

**Day 4 done criterion fully met.** The headline win: the Stack Overflow source — whose `65,000 desarrolladores` claim BUG-S58-5 falsely killed in production — now flows through the new chain to a published-ready draft. The bug class isn't just patched; it's structurally impossible by construction.

**External state changes:**
- GitHub: 4 commits on main this session (Day 4 build + grounding contract fix + grounding two-tier fix + state docs).
- Railway: 4 deploys, all ACTIVE.
- Anthropic: ~25 inference calls (~6K-10K tokens each, prompt caching active). Total cost <$0.50 across all smokes.
- Supabase: 1 post_queue row inserted (`cab31b62-4b0b-4e95-b2d2-4e1feeba3840`), no schema changes.
- DECISIONS.md: D-013 appended.

**New decisions logged:** D-013 (two-tier grounding, supersedes D-012's narrower interpretation).

**Step durations (live, last good run):**
- extract_claims: 12.2s
- strategist: 15.2s
- writer: 28.4s
- writer_grounding_rewrite: 26.0s
- editor: 16.2s
- spanish_editor: 11.4s
- qg_phase_a: 2.4s
- **total: 112.9s end-to-end**

**Lessons (some belong promoted to feedback memory eventually):**
- **Read the actual production code before porting.** Session 3's misread of the Strategist as deterministic would have produced a worse port if I'd built from memory. Pulling the JSON via MCP and reading it cost 5 min and changed the architecture.
- **Smoke tests against historical bug sources beat synthetic tests.** The Stack Overflow Survey URL wasn't just a placeholder; it WAS the BUG-S58-5 trigger. Testing against the historical kill case is what surfaced the D-012 → D-013 contract gap.
- **Architecture decisions decay if you don't periodically pressure-test them with real data.** D-012 looked complete after Session 3. Day 4's first real draft (with a curated subset narrower than the source's actual numeric density) immediately exposed its incomplete framing. That's a feature, not a bug — the senior posture says: ship, observe, refine the decision log.

## Next session

**Day 5 — Notion sync + Designer.** Resume with `[MVP] resume`. First actions:
1. Build `src/sync/notion-brand.ts` — read 9 Notion DBs filtered to Client=Hashtag, upsert `brand_identity` jsonb. Cron 5-min loop + `POST /admin/refresh-brand/:slug` endpoint.
2. Verify Hashtag's full identity (~45 rows) populates from Notion.
3. Re-run Day 4 smoke with the FULL identity — confirm Strategist now picks REAL pillar / recipe / hook / CTA names (not Sonnet-improvised names like `IDENTITY_CONFRONT — data-rich edition`).
4. Begin Designer port — HCTI + Gemini + GCS + GDrive rendering chain from CD v3 archived workflow. Designer consumes the `WriterDraft` from `post_queue.payload`, produces slide image URLs, advances `status` to `designed`.
