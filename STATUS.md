# STATUS — content_agency_mvp

**Day 2 (2026-05-01) — ✅ DONE. Data layer live, Brand 0 (Hashtag) seeded, /health shows it.**

## Where we are

End of Day 2. The Node service has a working data layer (Postgres + typed db modules + AES-256-GCM secret encryption + per-brand health surface) and Brand 0 (Hashtag Agencia) is seeded with its operational fields and a partial brand_identity jsonb (themes, pillars, blueprints, photo — 5 of 45 known active rows from Notion).

`/health` returns:
```json
{"status":"ok","db":{"ok":true,"latencyMs":~120ms},"brands":[{"slug":"hashtag","name":"Hashtag Agencia","status":"onboarding"}],"brandCount":1}
```

Day 3 starts with: Anthropic SDK wrapper with prompt caching → port the Strategist agent as the pattern → /run-pipeline endpoint that runs Brand 0 through Strategist as a smoke test.

## What we have

- ✅ Day 1 complete (HTTP server live, Sentry verified — see Session 1.5 in SESSION_LOG)
- ✅ Postgres schema: 5 tables (`brands`, `brand_configs`, `post_queue`, `post_results`, `analytics_snapshots`). UUID PKs, soft-delete via `archived_at`, RLS enabled, `updated_at` triggers.
- ✅ `brand_configs.brand_identity` is jsonb (D-009) — passive mirror of Notion's 9 brand DBs.
- ✅ MASTER_ENCRYPTION_KEY (AES-256-GCM key) live on Railway.
- ✅ Anthropic project-dedicated key live on Railway (separate from n8n production key for cost tracking).
- ✅ Code modules: `src/lib/{env,sentry,crypto,supabase}.ts`, `src/db/{types,brands,posts}.ts`. Typecheck clean.
- ✅ `/health` endpoint upgraded: DB connectivity check + per-brand summary, returns 503 on any failure.
- ✅ Brand 0 (Hashtag) seeded with operational fields + partial brand_identity (1 theme + 3 pillars + 1 blueprint + 1 photo config).
- ✅ Decisions logged: D-008 (AES) + D-009 (jsonb) + D-010 (5-min sync + on-demand refresh) + D-011 (token rotation Day 7).
- ✅ Idempotent SQL seed at `supabase/seed/brand_0_hashtag.sql` (re-runnable).

## What we don't have yet (Day 3+)

- ⚪ Anthropic SDK wrapper with prompt caching (Day 3, first thing)
- ⚪ Strategist agent ported from n8n `UR5qfUcOoO6djxIP` (Day 3 pattern)
- ⚪ Writer / Editor / Spanish Editor / QG (Day 3-4)
- ⚪ Designer agent (Day 4 — HCTI + Gemini + GCS + GDrive)
- ⚪ Notion sync job — pull all 9 DBs filtered to Client=<brand>, upsert `brand_identity` (Day 5 — D-010)
- ⚪ `/run-pipeline` endpoint + `/admin/refresh-brand/:slug` endpoint (Day 5)
- ⚪ Multi-brand testing with isolation (Day 6)
- ⚪ Onboarding CLI for Maria (Day 7)
- ⚪ Per-brand IG token rotation (Day 7 evening per D-011) + per-brand publishing wiring (Day 8)
- ⚪ Reliability hardening: circuit breakers, runbook (Day 9)
- ⚪ E2E + first real brand onboarded (Day 10)

## Health

| Component | Status |
|---|---|
| Plan | 🟢 complete |
| Architecture | 🟢 8 active decisions logged (D-001 through D-011, less D-001 numbering quirk) |
| Code | 🟢 data layer complete, typecheck clean |
| Infrastructure | 🟢 Railway → Sentry → Supabase end-to-end |
| Brand 0 seeded | 🟢 partial — operational + 4 of 9 identity categories (Day 5 sync fills the rest) |
| First pipeline run | ⚪ Day 3 target |
| First real brand onboarded | ⚪ Day 10 target |
| Live with paying brand | ⚪ Day 11-14 target |

## Current blockers

None.

## Last session

**2026-05-01 (Session 2 — Day 2 DONE):**

Started with the placeholder Anthropic key from Day 1. Generated a project-dedicated Anthropic API key (`content-agency-mvp` in Ivan's Individual Org) via Chrome MCP, swapped into Railway env, redeployed clean. Generated MASTER_ENCRYPTION_KEY (32-byte AES-256, base64), added to Railway env.

Wrote initial migration `0001_init.sql` with 5 tables — applied via Supabase SQL Editor (Monaco injection trick: `monaco.editor.getEditors()[0].setValue(decoded)`).

**Mid-Day-2 schema pivot (D-009):** discovered Hashtag's brand identity is composed of 9 separate Notion databases (Brand Themes, Pillars, Image Strategy Rules, Blueprints, Content Recipes, CTA Bank, Hook Bank, Lexicon, Photo Config). My original schema had 5 fixed creative columns — would have forced ALTER TABLE every time creative team added a new dimension. Pushed back, proposed `brand_identity jsonb` as passive mirror of Notion. Ivan initially misread as "config in code" — clarified Notion stays the ONLY human edit surface, jsonb is just an efficient cache. He agreed. Wrote `0002_brand_identity_jsonb.sql` (drops 5 typed columns, adds `brand_identity jsonb` + `brand_identity_synced_at` + `brand_identity_source`). Applied.

**D-010 sync architecture call:** synced cache (5-min interval) + `POST /admin/refresh-brand/:slug` for instant pulls. Pipeline reads from Postgres only (sub-1ms vs 1.5s × 9 Notion API calls; survives Notion outages).

**D-011:** deferred Hashtag IG token rotation to Day 7 evening (atomic OAuth dance session) — token isn't needed by Node service until Day 8 publishing.

Built code modules: `src/lib/crypto.ts` (AES-256-GCM with `MASTER_ENCRYPTION_KEY`), `src/lib/supabase.ts` (admin + public client singletons + `checkDbHealth`), `src/db/types.ts` (hand-rolled types for 5 tables), `src/db/brands.ts` (CRUD + `upsertBrandIdentity` for D-010 sync), `src/db/posts.ts` (idempotent enqueue, status updates, publish recording).

Upgraded `/health` to surface DB latency + per-brand status, with 503 on any failure (still answers).

**Brand 0 seed pivot:** hit Notion's 9 DBs and found 45 active Hashtag rows total. Senior call: did NOT fetch all 45 (~10 min round-trips for data Day 5 sync overwrites). Seeded with the 5 most-load-bearing rows already fetched (1 theme + 3 pillars + 1 blueprint + 1 photo config). Used Supabase REST API directly via curl (cleaner than Monaco SQL editor for large jsonb payloads).

**Final verification:** `/health` returns 200 with Brand 0 visible — full data layer roundtrip proven.

**Lessons for KNOWN_ISSUES.md (will append):**
- Supabase SQL Editor's Monaco editor accepts `monaco.editor.getEditors()[0].setValue(text)` for programmatic content injection. Confirmation modals appear for "destructive" queries (CREATE/DROP/ALTER) — find button by text "Run this query".
- Supabase REST API via PostgREST is the cleanest path for large jsonb inserts (vs SQL editor): `POST /rest/v1/<table>` with `apikey` + `Authorization: Bearer` headers (both = secret key) and `Prefer: return=representation,resolution=merge-duplicates`.

## Next session

**Day 3 — Pipeline engine + prompt caching.** Resume with `[MVP] resume`. First actions:
1. Build `src/lib/anthropic.ts` — SDK wrapper with `cache_control: ephemeral` on system prompts (per D-002)
2. Port Strategist agent (n8n `UR5qfUcOoO6djxIP`) as the pattern — read prompt from existing n8n config, parameterize by `brand_identity.pillars` + `brand_identity.blueprints`
3. Build `src/pipeline/strategist.ts` + `src/pipeline/types.ts` (envelope shape per pipeline contract)
4. Smoke test: `/run-pipeline` endpoint → Brand 0 → Strategist → returns selected pillar + topic
5. Verify cache hit rate logs in Sentry breadcrumbs
6. If Strategist works clean: port Writer same day (it's the next link)
