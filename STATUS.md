# STATUS — content_agency_mvp

**Day 6 (2026-05-02 CST) — ✅ DONE. Designer port live. Full chain end-to-end produces a 7-slide carousel with public Supabase Storage URLs in 165s. Phase A revise loop exercised live (initial revise → Writer rewrite → Editor → Spanish → Phase A retry → pass). All 7 slide types render correctly: typography (dark + light), person_photo (Gemini-generated portrait), data_card, object_photo (Gemini-generated scene), closing_cta.**

## Where we are

End of Day 6. The Node service has the **complete text + image-rendering pipeline** running on real synced identity:

- ✅ Day 1-5: HTTP server, data layer, full text-side chain, Notion sync.
- ✅ **Day 6 (Session 6):**
  - Designer module (~500 LOC): photo prompt enrichment from `brand_identity.photo` (deterministic, weighted-pool port from n8n) → Gemini 2.5 Flash Image parallel calls for person_photo / object_photo → 6 HTML templates verbatim from production → HCTI Hosted render @ 1080×1350×2 dpi → Supabase Storage upload → public URL written back to slide.url.
  - Per-slide error isolation: one HCTI/Gemini failure doesn't kill the whole carousel; partial-fail tagged in `status_reason`.
  - Status flow extended: `qg → designer → ready` (was `qg → ready`).
  - Supabase Storage bucket `mvp-content` (public, 10MB cap, image MIME) created via REST.
  - D-015 logged: storage = Supabase Storage (not GDrive). Auth simplicity + IG-publish friendliness + no new infra.
- ✅ **Verified live:** smoke test against `https://survey.stackoverflow.co/2024/` reaches `status='ready'` in 165s with **7/7 slides rendered + uploaded** with Supabase public URLs returning `200 image/png`. Photo slides (5.5–6.0 MB) embed Gemini-generated backgrounds; text slides (524 KB–633 KB) typography-only.

## What we don't have yet (Day 7+)

- ⚪ **Multi-brand isolation test** — duplicate Brand 0 to a synthetic Brand 1 with different `notion_client_filter`, verify Strategist for Brand 1 cannot see Brand 0's pillars. Day 7 AM (deferred from Day 6 per scope priority — Designer was the bigger lift).
- ⚪ **Onboarding CLI** — Day 7 AM after isolation test.
- ⚪ **Hashtag IG token rotation** Day 7 PM (per D-011).
- ⚪ **Per-brand publishing** (IG Graph API publish path consuming the Designer's URLs) Day 8.
- ⚪ **Reliability hardening** Day 9.
- ⚪ **E2E + first real brand onboarded** Day 10.

## Health

| Component | Status |
|---|---|
| Plan | 🟢 |
| Architecture | 🟢 15 active decisions (D-001 through D-015) |
| Code | 🟢 full text + image chain live, typecheck clean |
| Infrastructure | 🟢 Railway → Sentry → Supabase (DB + Storage) → Anthropic + Notion + Gemini + HCTI |
| Brand 0 seeded | 🟢 FULL identity synced from Notion (Day 5) |
| First extraction live | 🟢 (Day 3) |
| First full draft text-ready | 🟢 (Day 4) |
| Pipeline running on real Hashtag identity | 🟢 (Day 5) |
| **First fully-rendered carousel with public URLs** | 🟢 (Day 6) |
| Multi-brand isolation verified | ⚪ Day 7 target |
| Per-brand publishing | ⚪ Day 8 target |
| First real brand onboarded | ⚪ Day 10 target |
| Live with paying brand | ⚪ Day 11-14 target |

## Current blockers

None.

## Last session

**2026-05-02 CST (Session 6 — Day 6 DONE — Designer live, full chain ships designed carousels):**

1. **Senior pre-build calls up-front:** HCTI hosted (matches production), Gemini 2.5 Flash Image (matches production code, NOT Gemini 3 Pro — that's the text rule), GDrive **rejected** for storage in favor of Supabase Storage (D-015 — auth simplicity + IG-publish friendliness + no new infra).
2. **Pulled Designer A4 (`8KYkBaKg3yeRummd`) via MCP** + extracted "Build Render Jobs" code (19KB) via `jq`. Read the actual production code: photo prompt enrichment from photo_config strings ("European 50% · Asian 30%" weighted-pool format), Gemini 2.5 Flash Image parallel calls, 6 HTML templates inline, HCTI render, GDrive upload.
3. **Created Supabase Storage bucket** `mvp-content` via single REST call: `POST /storage/v1/bucket` with `{public:true, file_size_limit:10MB, allowed_mime_types:[png,jpeg,webp]}`. Returned 200 in <1s.
4. **Built `src/pipeline/designer.ts`** (~500 LOC, faithful port):
   - Prompt enrichment: deterministic weighted-pool picks for ethnicity / wardrobe / setting / time of day / palette / surface (port of n8n's `pickWeighted` + `parseEthnicity` + `parseWardrobe` + `parseList`).
   - `generateAllPhotos()`: `Promise.allSettled` parallel Gemini calls; image base64 attached to a per-index map.
   - 6 HTML template functions (typography_dark, typography_light, person_photo, object_photo, data_card, closing_cta) — verbatim port; only diff is they take a `ThemeColors` object built from `brand_identity.themes[0]` instead of hardcoded.
   - HCTI render → download PNG bytes → upload to Supabase Storage → return public URL.
   - Per-slide error isolation: one HCTI/Gemini fail doesn't kill the carousel.
5. **Wired Designer into `chain.ts`** after QG Phase A pass: status flow now `qg → designer → ready`. All-fail → mark failed with `failure_category='designer_all_failed'`. Partial-fail → status_reason names the count (`designer_partial: 5 ok, 2 failed`).
6. **Added 3 Railway env vars** via the per-variable form (HCTI_USER_ID + HCTI_API_KEY + GEMINI_API_KEY). Deployed.
7. **Committed + pushed** (`47abe86` Day 6 build, 5 files, 579 insertions).
8. **Day 6 smoke test against `https://survey.stackoverflow.co/2024/`:**
   - `status='ready'` in **165s end-to-end**.
   - **7/7 slides rendered** with public URLs, 0 failed.
   - Phase A revise loop exercised live (initial revise → Writer rewrite → Editor → Spanish → Phase A retry → pass) — never seen in a previous smoke run.
   - All 6 slide types covered: typography_dark + typography_light + person_photo + data_card + object_photo + closing_cta.
9. **Visual verification of slide 01, 02, 05:**
   - Slide 01 (typography_dark): clean hook with red `YA MURIÓ` accent, 65,437 + 185 países anchored. Spanish correct.
   - Slide 02 (person_photo): Gemini editorial portrait of a person at a laptop in a modern office with natural light. Brand text overlay clean.
   - Slide 05 (object_photo): Gemini interpreted MySQL-vs-PostgreSQL as analog measurement gauges — creative + on-brand. Real source numbers (59% / 49% / 33% / 2018) anchored. Source attribution ("Según Stack Overflow") present.
10. **D-015 logged** documenting storage choice rationale.

**Day 6 done criterion fully met.** The pipeline now produces production-quality finished carousels end-to-end. Day 8 publishing has everything it needs (public PNG URLs + IG-Graph-API-friendly content type).

**Step durations (Day 6 smoke, full chain including Designer + Phase A revise loop):**
| Step | Duration |
|---|---|
| extract_claims | 13.3s |
| strategist | 15.0s |
| writer | 22.2s |
| editor | 18.3s |
| spanish_editor | 9.7s |
| qg_phase_a | 7.8s |
| writer_phase_a_rewrite | 21.3s |
| editor_phase_a_rewrite | 16.6s |
| spanish_editor_phase_a_rewrite | 9.8s |
| qg_phase_a_retry | 3.0s |
| **designer** | **27.0s** (7 slides, 2 Gemini calls + 7 HCTI renders + 7 storage uploads) |
| **TOTAL** | **165.8s** |

**Lessons:**
- **Read the production code BEFORE choosing dependencies.** I almost reached for GCS by default; pulling Designer A4 via MCP + reading the actual code revealed (a) HCTI is the right rendering engine, (b) Gemini's specific model name, (c) GDrive's auth complexity that I could sidestep by switching to Supabase Storage — same project, already authenticated.
- **Per-slide error isolation matters.** A single Gemini timeout (30s+) shouldn't kill a 7-slide carousel. The `for` loop with try/catch + `failures[]` accumulator is the right pattern; partial-fail status_reason gives Day 8 publishing the signal it needs.
- **Public bucket + deterministic path = simplest possible URL story.** No signed URLs, no expiration, no extra round-trips. IG Graph API on Day 8 will accept these directly.
- **Phase A revise loop validated live for the first time.** Day 4-5 smokes never tripped Phase A's `revise` verdict; Day 6's first run did. The Writer rewrite path + Editor + Spanish + Phase A retry all worked cleanly. ~70s extra latency for the recovery, all four steps' duration captured in telemetry.

**External state changes:**
- GitHub: 1 commit on main (`47abe86` Day 6 Designer port). State-docs commit pending.
- Railway: 3 env vars added (HCTI_USER_ID, HCTI_API_KEY, GEMINI_API_KEY); 1 deploy ACTIVE.
- Supabase: bucket `mvp-content` created (public, image MIME, 10MB cap); 7 slides uploaded under `hashtag/b0ebe1ca-8f1a-44bb-a584-9329cc32fab5/` for the test post.
- Anthropic: ~6 inference calls (Strategist + Writer×2 + Editor×2 + Spanish×2 + Phase A×2). Caching active.
- Gemini: 2 image-gen calls (person_photo + object_photo). ~30s each at the API tail.
- HCTI: 7 render calls (one per slide). ~3s each.

**New decisions logged:** D-015 (Supabase Storage for slide PNGs).

## Next session

**Day 7 — Multi-brand isolation test + onboarding CLI + Hashtag IG token rotation.** Resume with `[MVP] resume`.

First actions:
1. **Multi-brand isolation test:** insert synthetic Brand 1 with `notion_client_filter='TestClient'` (which doesn't exist in Notion → 0 rows on sync). Verify Strategist refuses to run for Brand 1 (or runs with empty identity — both are valid outcomes, but they MUST NOT silently leak Brand 0's pillars).
2. **Onboarding CLI** (~200 LOC): `npm run onboard <slug> <name> <client_filter>` creates the brand row + brand_config row + triggers initial Notion sync. Replaces the manual `INSERT INTO brands` + `UPDATE brand_configs` dance.
3. **Hashtag IG token rotation (atomic session per D-011):** OAuth dance via Graph API Explorer to mint a fresh 60-day token; encrypt + write to `brand_configs.ig_token_encrypted`; verify with a `debug_token` call.
4. Day 8 prep: scan IG Graph API publishing semantics; queue Day 8 work items.
