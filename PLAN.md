# PLAN — content_agency_mvp 14-Day MVP

> Locked at planning (2026-04-30). Changes require a `[MVP] decision:` entry in DECISIONS.md.

## Goal

Ship multi-tenant AI content production system for SMB owners willing to pay $25-35K MXN/month for daily content. IG only. Spanish only. Full FSD autonomy. Reliable enough to charge.

## Scope (locked)

**IN:**
- Multi-tenant pipeline (Strategist → Writer → Editor → Spanish-Editor → QG → Designer)
- IG publishing (reuses existing Publisher A6 in n8n)
- Notion-per-brand creative controls
- Supabase data layer (brands, post queue, analytics, credentials)
- Sentry observability
- 60-min onboarding flow Maria can run
- 3+ brands tested (Brand 0 = Hashtag, plus 2 fakes for isolation testing)
- First real paying brand onboarded by Day 10

**OUT (deferred — scope additions require decision log):**
- LinkedIn publishing → weeks 3-4
- Learning loop (analytics → prompt feedback) → weeks 5-6
- Admin UI for Ivan/Maria → weeks 5-6
- Client-facing dashboard → forever (full-FSD service model)
- Languages other than Spanish → forever (MVP)
- Cross-brand intelligence → forever

## Architecture (locked — see DECISIONS.md D-001 through D-007)

| Layer | Tech | Why |
|---|---|---|
| Pipeline engine | Node.js + TypeScript | Matches existing eval harness |
| LLM | Anthropic SDK (Sonnet for routine, Opus for judgment) + prompt caching | Cost discipline + battle-tested |
| Database | Supabase (Postgres) | Managed, scales, no ops burden |
| Creative controls | Notion-per-brand (master template + duplicate per brand) | Maria's existing skill; isolation by design |
| Deploy | Railway | Cheap, easy, supports cron + long-running services |
| Observability | Sentry | Real-time error capture, per-brand tagging |
| CI/CD | GitHub Actions | Standard |
| Triggers + Publish | n8n (existing Cron + Publisher A6) | Don't rebuild what works |
| Image hosting | GCS proxy (existing) | IG can't fetch from lh3 — already solved |

---

## Week 1 — Foundation + Brand 0 Running

### Day 1 (Mon, 2026-05-04) — Bootstrap
**Goal:** Repo deploys to Railway, eval harness runs in container, Sentry captures errors.

- [ ] Init `content_agency_mvp/` as TypeScript project (npm init, tsconfig, package.json)
- [ ] Set up GitHub repo
- [ ] Create Supabase project (free tier OK)
- [ ] Create Railway project, link GitHub
- [ ] Set up Sentry project, get DSN
- [ ] Configure GitHub Actions for typecheck + test on PR
- [ ] Port `content_pipeline/eval/run.mjs` into `src/pipeline/run.ts` (no logic changes yet — just relocate + TypeScript)
- [ ] First deploy: `npm run start` runs the existing eval harness on Railway
- [ ] Verify: trigger an error, see it in Sentry within 30s

**Smoke test:** Pipeline runs once on Railway against a SMOKE-S57 fixture. Output matches local eval.

### Day 2 (Tue) — Data Layer
**Goal:** Brand 0 (Hashtag) row exists in Postgres; config readable; queue insert/update works.

- [ ] Postgres schema:
  - `brands` (id, name, slug, status, created_at)
  - `brand_configs` (brand_id, voice, pillars[], banned_words[], target_audience, brand_colors{}, fonts{}, ig_account_id, ig_token_encrypted, notion_db_id)
  - `post_queue` (id, brand_id, status, source_url, brief_json, slides_json, scheduled_for, ig_post_id, error_log)
  - `analytics_snapshots` (brand_id, post_id, captured_at, likes, comments, saves, reach, engagement_rate, weighted_er)
- [ ] Migrations + seeds (SQL files committed to repo)
- [ ] Service modules:
  - `src/db/brands.ts` — `getBrandConfig(brand_id)`, `listActiveBrands()`
  - `src/db/posts.ts` — `enqueuePost`, `updatePostStatus`, `markFailed`
- [ ] Insert Hashtag Agencia as Brand 0 with current config mirrored from existing Notion
- [ ] Encrypted credentials column (use `pgcrypto` or app-level AES; document choice in DECISIONS.md)

**Smoke test:** `node -e "import('./src/db/brands.js').then(m => m.getBrandConfig(0)).then(console.log)"` prints Brand 0's config.

### Day 3 (Wed) — Pipeline Engine, Brand-Parameterized
**Goal:** Same input + same brand produces same output as current n8n chain.

- [ ] Refactor each chain step to take `brand_config` as input:
  - `src/pipeline/strategist.ts` — accepts brand voice/pillars/banned_words; returns brief JSON
  - `src/pipeline/writer.ts` — accepts brief + brand_config; returns slide drafts
  - `src/pipeline/editor_rules.ts` — applies CTA-immutable + named-brand + accent_text rules
  - `src/pipeline/spanish_editor.ts` — Mexican-Spanish polish + length sanity
  - `src/pipeline/quality_gate.ts` — Phase A fact-check + Phase B rubric (with `has_all_urls` patch)
- [ ] Anthropic SDK calls use `cache_control: {type: 'ephemeral'}` on system prompts
- [ ] Verify caching with `usage.cache_creation_input_tokens` / `cache_read_input_tokens` in response
- [ ] Smoke: run SMOKE-S57 fixtures through new chain → compare against n8n output (exact JSON diff)

**Smoke test:** 3/3 SMOKE-S57 fixtures reach `text_approved` matching the n8n chain output. Token usage shows >50% cache hit rate by post 2.

### Day 4 (Thu) — Designer Port
**Goal:** Full Strategist→Designer chain runs end-to-end for Brand 0.

- [ ] Port HCTI client → `src/designer/hcti.ts` (with retry+timeout)
- [ ] Port Gemini client → `src/designer/gemini.ts`
- [ ] Port GCS proxy → `src/designer/gcs_proxy.ts` (carry forward base64-string-body workaround for sandbox quirks → here it just works because we're not in n8n sandbox anymore — simpler implementation)
- [ ] Port GDrive uploader → `src/designer/gdrive.ts`
- [ ] Carousel id=0 retry + container poll (BUG-S58-1 fix carried as tested function)
- [ ] Smoke: SMOKE-S57 brief → image_generated, slides URLs valid

**Smoke test:** End-to-end run of Brand 0's SMOKE-S57 fixture → image_generated → URLs publicly fetchable.

### Day 5 (Fri) — Notion Integration
**Goal:** Config edits in per-brand Notion DB propagate to pipeline within 5 min.

- [ ] Master Notion template: per-brand workspace with Brand Config DB + Content Queue DB + CTA Bank DB
- [ ] `src/notion/sync.ts` — pulls brand_config from Notion DB → upserts into Postgres
- [ ] Cron: every 5 min, `npm run sync-notion-configs` runs against all active brands
- [ ] Brand 0 config now lives in dedicated Notion workspace (not the shared one)
- [ ] Test: edit brand voice in Notion → wait 5 min → verify Postgres updated → next pipeline run uses new voice

**Smoke test:** Change Brand 0's voice from "confident, direct" to "confident, playful, direct" in Notion. Verify pipeline picks up new voice within 5 min.

### End of Week 1 milestone
**Brand 0 (Hashtag Agencia) running daily content via the new system in shadow mode against the current n8n pipeline. 5+ days of side-by-side comparison data captured for cutover decision.**

---

## Week 2 — Multi-Brand + Onboarding + Reliability

### Day 6 (Mon) — Multi-Brand Testing
**Goal:** 3 brands × 1 post each in single cron tick, fully isolated.

- [ ] Add 2 fake test brands with distinct configs:
  - Brand 1: "TechMX" — voice = academic, pillars = AI/SaaS/dev tools
  - Brand 2: "ModaCDMX" — voice = warm/aspirational, pillars = fashion/lifestyle
- [ ] Cron job runs all 3 brands in a single execution
- [ ] Per-brand circuit breaker: if Brand 1 fails, Brand 0 + Brand 2 still run
- [ ] Verify zero cross-contamination (no Brand A's content appearing in Brand B logs/output)
- [ ] Per-brand Sentry tags so errors are attributable

**Smoke test:** Trigger one cron tick. All 3 brands produce one post each. Force Brand 1 to fail (kill its API key). Brand 0 + Brand 2 still ship.

### Day 7 (Tue) — Onboarding Flow
**Goal:** Onboarding takes <60 min for a fresh brand.

- [ ] CLI: `npm run onboard-brand` — interactive prompts for:
  - Brand name + slug
  - Voice (3 sentences)
  - Pillars (1-5)
  - Banned words / no-go topics
  - Target audience
  - Brand colors (hex), fonts
  - IG account handle (token connection deferred to Day 8)
- [ ] Script:
  1. Duplicates master Notion template into new brand workspace
  2. Inserts brand row into Postgres with config
  3. Generates onboarding doc (markdown) with checklist for Maria
  4. Outputs Notion URL Maria sends to client (or keeps internal)
- [ ] Time it end-to-end with stopwatch (target: <60 min total including human input)

**Smoke test:** Maria onboards a fake brand "TestCo" using only the CLI + prompts. Time it. Document any rough edges.

### Day 8 (Wed) — Per-Brand Publishing
**Goal:** Per-brand posts route to correct IG accounts; zero cross-account confusion.

- [ ] Per-brand IG OAuth tokens stored encrypted in Supabase (`brand_configs.ig_token_encrypted`)
- [ ] Token-refresh cron (daily `debug_token` check per A8 pattern)
- [ ] Publisher A6 (n8n) modified to: receive `brand_id` in webhook → look up brand's tokens via HTTP call to Node service → publish to that brand's IG account
- [ ] Test: trigger a publish for Brand 0 + Brand 1 + Brand 2 (each to their own test IG account, e.g., @hashtag_labx for Brand 0)

**Smoke test:** 3 different brands publish 1 post each, each to the correct IG account. No cross-account leakage in n8n or Sentry logs.

### Day 9 (Thu) — Reliability Hardening
**Goal:** Production-grade error handling. Every failure surfaces within 60s.

- [ ] Sentry hooks at every critical step (each pipeline step + Designer + Publisher webhook)
- [ ] Idempotency keys on every post operation (UUID per post, prevents double-posts on retry)
- [ ] Health check endpoint: `GET /health` returns `{ status: 'ok' | 'degraded', brands: [{id, status}] }`
- [ ] Health alerts route to existing Telegram Notifier Hub (no new infra needed)
- [ ] Replace any remaining n8n Code-node logic in agent chain (audit n8n for orphan jsCode that didn't make the move)
- [ ] Document runbook: `docs/RUNBOOK.md` — top 5 likely failures + fix steps

**Smoke test:** Force 3 different failures (Anthropic 429, Notion 500, IG token revoked). Each surfaces in Telegram within 60s with actionable error message.

### Day 10 (Fri) — End-to-End + First Real Brand Prep
**Goal:** First real paying brand onboarded, posts queued, ready to ship Monday Week 3.

- [ ] Full week of dry-run for Brand 0 + 2 fakes (5 posts each = 15 posts) — verify no surprises
- [ ] Bug fixes from week's findings
- [ ] One-pager docs:
  - `docs/ADD_BRAND.md` (Maria's procedure, 60 min)
  - `docs/RUNBOOK.md` (top failures + fixes)
  - `docs/ARCHITECTURE.md` (service map, data flow)
- [ ] Ivan picks brand #1 (real client or test prospect)
- [ ] Maria runs onboarding for that brand with Ivan supervising
- [ ] First content batch runs in dry-run mode for Ivan's review

**Smoke test:** First paying brand has 7 days of content queued. Ivan approves first 3 posts manually. FSD turns on for posts 4-7.

---

## Buffer (Sat/Sun, 2026-05-15 / 16)

Catch-up. Polish. Prep for live launch Monday Week 3.

## Days 11-14 (Mon-Thu, 2026-05-17 to 20) — Live Launch + Active Monitoring

- Real paying brand on the system. 4 posts/day per existing schedule pattern.
- Active Sentry monitoring. Bug-fix cadence: same-day for any error.
- Voice/quality observation by Ivan/Maria daily.
- Iterate prompts based on first-week observations.
- Day 14: post-launch review. Decide whether to onboard brand #2 in week 3 or stabilize first.

---

## Risks (watch for, don't block on)

1. **Per-brand prompt tuning** — first week of any new brand will produce mediocre content until prompts learn the voice. Manual review at first; learning loop arrives weeks 5-6.
2. **HCTI 5-10% transient failures** — carry forward existing retry+poll pattern.
3. **Notion → Supabase 5-min sync latency** — acceptable for MVP; webhook upgrade later.
4. **Maria capacity** — 60 min × 5 brands = 5 hours of her time. Confirm she has it.
5. **IG anti-spam throttle in dev** — limit to ≤5 publish probes per account per hour; use diagnostic mode for chain testing.
6. **LinkedIn API requires App Review for posting** — pre-flight in Week 2 so we know what we're walking into in Week 3.
7. **First-paying-brand panic** — if brand #1's content quality is bad, don't blame the architecture, fix the prompts. Document everything for the learning loop.

---

## Pre-flight (do BEFORE Day 1 starts — NOT MVP work)

- [ ] Ivan: confirm Supabase account exists or sign up (~5 min)
- [ ] Ivan: confirm Railway account exists or sign up (~5 min)
- [ ] Ivan: confirm Sentry account exists or sign up (~5 min)
- [ ] Ivan: confirm GitHub repo creation permission for `content_agency_mvp`
- [ ] Maria: blocked time for Day 7 onboarding rehearsal + Day 10 first-real-brand onboarding

---

## Decision points (where the plan can change)

- **End of Day 5:** if shadow-mode comparison Brand 0 new-vs-n8n is <90% match → debug before Week 2.
- **End of Day 10:** if first real brand isn't ready or Maria's blocked → delay launch by 2 days, don't rush.
- **End of Week 2:** decide whether to add LinkedIn in Week 3 or stabilize Brand 0+1 first.
