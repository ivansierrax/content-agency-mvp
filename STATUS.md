# STATUS — content_agency_mvp

**Day 5 (2026-05-02 CST) — ✅ MINIMUM DONE. Notion → Postgres brand-identity sync live (5-min cron + on-demand admin endpoint). Hashtag's full identity (80 rows across 8 categories) syncs in 1.9s. Day-4 smoke re-runs cleanly with REAL Hashtag pillar/recipe/hook/CTA names linked by Notion ID. Designer port deferred to Day 6 — clean session, focused block.**

## Where we are

End of Day 5 minimum scope. The Node service has the **full text-side pipeline running on real synced identity:**

- ✅ Day 1-4: HTTP server, data layer, full text-side chain (Strategist → Writer → Editor → Spanish → QG Phase A).
- ✅ **Day 5 minimum (Session 5):**
  - Notion sync module reads 8 shared Hashtag-agency data sources, filtered to one brand's `Client` select.
  - 5-min recurring scheduler with ±60s jitter, per-brand error isolation, single-replica caveat documented.
  - `POST /admin/refresh-brand/:slug` on-demand sync.
  - Migration 0003: `brand_configs.notion_client_filter` (Brand 0 seeded `'Hashtag'`).
  - Boot wiring: scheduler starts after server.listen.
  - D-014 logged.
- ✅ **Verified live:** sync ran in 1.9s, populated 1 theme + 5 pillars + 6 recipes + 15 ctas + 12 hooks + 36 lexicon + 4 image_rules + 1 photo (= **80 rows total**). Zero warnings.
- ✅ **Day-4 smoke re-run with full identity:** `status='ready'` in 79.3s (vs 113s yesterday — Writer needed no rewrite because the brief was tighter with real pillar/recipe inventory). Strategist now picks REAL names with Postgres IDs:
  - pillar: **"AI / Marketing con IA"**
  - recipe: **DEATH_DATA**
  - hook: **"Death 2 — operating-dead-model"**
  - cta: **"AI • Save"**
  - 20 numbers in draft, all 20 anchored.

## What we don't have yet (Day 6+)

- ⚪ **Designer port** (HCTI + Gemini + GCS + GDrive rendering chain) — deferred from Day 5 to Day 6. Genuinely big port (~600 LOC of HTML/CSS templates from CD v3 + Gemini API wiring + GCS bucket setup + GDrive auth). Day 6 AM block.
- ⚪ **Multi-brand testing** (3 brands isolated, no cross-brand leakage) — Day 6 PM after Designer.
- ⚪ **Onboarding CLI** Day 7 AM. **Hashtag IG token rotation** Day 7 PM (per D-011).
- ⚪ **Per-brand publishing** Day 8.
- ⚪ **Reliability hardening** Day 9.
- ⚪ **E2E + first real brand onboarded** Day 10.

## Health

| Component | Status |
|---|---|
| Plan | 🟢 |
| Architecture | 🟢 14 active decisions (D-001 through D-014) |
| Code | 🟢 full text chain + Notion sync live, typecheck clean |
| Infrastructure | 🟢 Railway → Sentry → Supabase → Anthropic + Notion |
| Brand 0 seeded | 🟢 **FULL identity synced from Notion** (was 🟡 partial through Day 4) |
| First extraction live + verified | 🟢 (Day 3) |
| First full draft reaching `status=ready` | 🟢 (Day 4) |
| Pipeline running on real Hashtag identity | 🟢 (Day 5) |
| Designer (image rendering) | ⚪ Day 6 target |
| First real brand onboarded | ⚪ Day 10 target |
| Live with paying brand | ⚪ Day 11-14 target |

## Current blockers

None.

## Last session

**2026-05-02 CST (Session 5 — Day 5 minimum DONE):**

1. **Pulled n8n Strategist's "Load Scouted + Creative Config" code via `jq`** to extract the 8 data-source IDs and the property-mapping pattern for each DB. Reused verbatim — no reinvention.
2. **Senior call up-front: reuse existing Hashtag Notion token, log Day 9 cleanup task** for migrating to a scoped read-only integration. Saves ~15 min of OAuth + 8-DB-share dance on Day 5; doesn't add new attack surface (token already had access).
3. **Built three modules:**
   - `src/sync/notion-brand.ts` (~400 LOC): 8 parallel `data_sources/{id}/query` calls, per-DB property mappers, `BrandIdentity` builder, `upsertBrandIdentity` with `synced_at` stamp.
   - `src/sync/scheduler.ts` (~80 LOC): 5-min `setInterval` with ±60s jitter, per-brand try/catch, `SCHEDULER_DISABLED=1` escape hatch.
   - `POST /admin/refresh-brand/:slug` in `src/index.ts` with optional `ADMIN_TOKEN` bearer auth + path-prefix matcher.
4. **Migration 0003** added `brand_configs.notion_client_filter` text column; Brand 0 seeded `'Hashtag'`. Applied via Supabase SQL Editor + Monaco injection (Day 2 pattern, worked first try once browser was switched to Ivan's Chrome — MCP's sandboxed browser had no Supabase session).
5. **Railway env vars added** via the per-variable "Add" button (Raw Editor's CodeMirror selection-replace is unreliable; "New Variable" form with `<textarea>` + React-friendly value setter is the bulletproof path). Deploy triggered automatically.
6. **First sync via `/admin/refresh-brand/hashtag` returned in 1.9s** with `counts={themes:1, pillars:5, recipes:6, ctas:15, hooks:12, lexicon:36, image_rules:4, photo:1}` and `warnings:[]`. **80 total rows** — substantially more than the partial Day 2 seed.
7. **Day-4 smoke re-ran with full identity** and reached `status='ready'` in 79.3s on first try:
   - REAL Hashtag pillar (`"AI / Marketing con IA"`), recipe (`DEATH_DATA`), hook (`"Death 2 — operating-dead-model"`), CTA (`"AI • Save"`) — all with Postgres IDs linked from Notion.
   - 7 slides, 20 numbers in draft, 0 unanchored, QG Phase A pass in 2.9s.
   - **No Writer rewrite needed** (vs Day 4's first pass needing one) — confirms the hypothesis that the tighter brief from real recipe/hook constraints reduces Writer fabrication pressure.
8. **D-014 logged.** Documents the shared-DB + `Client`-filter sync architecture (matches n8n verbatim), the single-replica caveat, and the alternatives rejected.
9. **Designer port deferred to Day 6.** TODO already allowed for the spill; senior call to close cleanly rather than start Designer late in the session.

**Day 5 done criterion (minimum) fully met.** The headline: the chain that yesterday improvised pillar names like `"IDENTITY_CONFRONT — data-rich edition"` now reaches into Hashtag's real curated inventory and picks names with stable IDs. Multi-brand isolation works (one brand's filter cannot accidentally see another's rows). The 5-min scheduler will keep this in sync continuously without manual intervention.

**Step durations (Day 5 smoke, full identity):**
| Step | Duration |
|---|---|
| extract_claims | 14.0s |
| strategist | 14.4s |
| writer | 19.1s (no rewrite needed) |
| editor | 18.5s |
| spanish_editor | 9.1s |
| qg_phase_a | 2.9s |
| **TOTAL** | **79.3s** |

**Lessons:**
- **Reuse the n8n property mappings verbatim, don't paraphrase.** The Notion property names ("Short Code", "Hashtag Seed Pool", "Forbidden Angles", "Min Metrics", etc.) encode hard-won schema decisions. Copying them character-for-character means the sync output matches what the chain (which itself was ported verbatim) expects. No translation layer needed.
- **Ivan's actual browser vs MCP's sandboxed browser** matters when targeting authenticated SaaS. MCP's `list_connected_browsers` + `select_browser` is the unblock pattern when SPA pages render empty (login wall).
- **Railway's "Add Variable" button beats Raw Editor's CodeMirror** for adding individual env vars. CM6 selection-replace is fragile under DOM event simulation; per-variable `<textarea>` form is reliable.
- **80 total rows ≠ MEMORY's "~45 rows"** — that older count was a partial Day 2 seed snapshot, not the full Notion inventory. Updated STATUS reflects the real number.

**External state changes:**
- GitHub: 1 commit on main (`ade542e` Day 5 sync + scheduler + admin endpoint). Plus state-docs commit pending.
- Railway: 1 deploy after env var changes, ACTIVE.
- Supabase: migration 0003 applied; `brand_configs.notion_client_filter` set to `'Hashtag'` for Brand 0; `brand_identity` jsonb populated with 80-row union (overwrote partial Day 2 seed).
- Notion: read-only access from new service via inherited Hashtag token. No writes.
- DECISIONS.md: D-014 appended.

**New decisions logged:** D-014 (sync architecture: shared DBs + per-brand `Client` filter, single-replica caveat).

## Next session

**Day 6 — Designer port + multi-brand testing.** Resume with `[MVP] resume`.

First actions:
1. Pull Designer A4 (`8KYkBaKg3yeRummd`) workflow via MCP; read the HCTI rendering chain + Gemini prompt builder + GCS upload + GDrive backup steps.
2. Decide port boundary: Node-side HCTI templates (~600 LOC of HTML/CSS) vs hosted HCTI service (paid). Default: hosted HCTI for MVP — same as production.
3. Build `src/pipeline/designer.ts` — consume `WriterDraft` from `post_queue.payload` (status=ready), produce slide image URLs, advance status to `designed`.
4. Day 6 PM: multi-brand testing — duplicate Brand 0 to a synthetic Brand 1, verify isolation (Strategist for Brand 1 cannot see Brand 0's pillars).
