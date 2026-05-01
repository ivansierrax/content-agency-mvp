# DECISIONS — content_agency_mvp

> Append-only architectural decision log. Once a decision is logged, it's load-bearing for the rest of the project.
> To change a decision: append a new D-### that supersedes the old one (don't edit historical entries).
> Format: ID, date, decision, why, alternatives rejected, status.

---

## D-001 — Multi-tenancy: shared backend + Notion-per-brand

**Date:** 2026-04-30
**Decision:** One shared Node.js service handles all brands, partitioned by `brand_id` everywhere. Each brand has their own Notion workspace duplicated from a master template for creative controls.
**Why:** Simpler ops (one deploy, one set of API credentials for Anthropic/GCS/etc.). Brand isolation enforced by `brand_id` filtering at the data layer + per-brand IG/LinkedIn tokens. Maria reuses Notion patterns she already knows. Scales cleanly to ~50 brands; past that, revisit.
**Alternatives rejected:**
- Fully isolated per-brand stacks (one deploy each) — too expensive, doesn't scale to "hundreds."
- Single shared Notion workspace with brand columns — cross-brand visibility risk + UI clutter.
**Status:** Active.

## D-002 — Tech stack: Node + TypeScript + Supabase + Anthropic SDK + Railway

**Date:** 2026-04-30
**Decision:**
- **Pipeline engine:** Node.js + TypeScript
- **LLM:** Anthropic SDK (`@anthropic-ai/sdk`) with prompt caching (`cache_control: ephemeral`)
- **Database:** Supabase (managed Postgres) — brands, configs, post queue, analytics, encrypted credentials
- **Creative controls:** Notion API (read-only from pipeline, writes via Maria's UI)
- **Deploy:** Railway
- **Observability:** Sentry
- **CI/CD:** GitHub Actions
- **Triggers + Publish:** existing n8n workflows (Cron + Publisher A6 + Telegram Hub)

**Why:** Node matches the existing eval harness foundation. TypeScript for type safety on multi-brand data shapes. Supabase = no DB ops burden. Railway = cheap, easy, supports cron + long-running services. Anthropic SDK direct (NOT Agent SDK) because the pipeline is deterministic (Strategist → Writer → Editor → SpanishEditor → QG → Designer), not autonomous. Prompt caching is non-negotiable for the cost-efficiency requirement.
**Alternatives rejected:**
- **Python** — slower iteration on existing JS code; no real benefit
- **Agent SDK** — wrong shape for deterministic pipelines; adds framework overhead with no value
- **Self-hosted Postgres** — ops burden; Supabase free tier covers MVP
- **Vercel** — worse for long-running cron and background jobs
- **Cloud Run / Lambda** — viable but Railway is simpler for week-1 ship

**Status:** Active.

## D-003 — Foundation: port-then-refactor existing pipeline

**Date:** 2026-04-30
**Decision:** Port the existing Strategist/Writer/Editor/Spanish-Editor/QG/Designer prompts and chain logic into the new Node service. Parameterize by `brand_config` (voice, pillars, banned_words, target_audience, etc.) loaded at runtime. Don't rewrite from scratch.
**Why:** Prompts are battle-tested through S57 series + BUG-S58-x fixes. A clean rewrite would burn 1+ week with high regression risk. The 2-week timeline doesn't allow it. Brand-parameterization is the *only* substantive change to the prompts in MVP.
**Alternatives rejected:**
- Clean rewrite from scratch — too risky, no business value
- Hybrid (some old, some new) — adds complexity with no clear seam

**Status:** Active.

## D-004 — Single platform for MVP: IG only

**Date:** 2026-04-30
**Decision:** IG-only for the 2-week MVP. LinkedIn moves to weeks 3-4 as a follow-on. TikTok/Reels are not in any near-term plan.
**Why:** LinkedIn is a brand-new integration (3-5 days alone, plus possible App Review delay for posting permission). The 2-week MVP budget can't absorb it. SMB owners in CDMX/GDL/MTY care about IG first; LinkedIn is icing. Better to ship IG-only at high quality than two platforms half-done.
**Alternatives rejected:**
- IG + LinkedIn parallel in MVP — will fail timeline
- LinkedIn-first — less buyer demand in target market
- IG + Reels (vertical video) — out of scope; image carousels are the proven shape

**Status:** Active until Day 10 review.

## D-005 — No learning loop in MVP

**Date:** 2026-04-30
**Decision:** Defer the analytics-driven learning loop to weeks 5-6. For weeks 1-4, rely on manual prompt tuning + weekly review by Ivan/Maria.
**Why:** A learning loop is statistically worthless without 30+ days of multi-brand data. Even if shipped in week 2, it would be making decisions on ~20 posts per brand — too noisy to learn from. Building it later means we have signal to validate against. Premature build risks acting confidently on bad data.
**Alternatives rejected:**
- Simple version in MVP (top-3 → few-shot examples) — would mislead by acting confident on tiny data
- Human-in-the-loop weekly tuning ritual + no automation — that's actually what we're doing for the first 4 weeks

**Status:** Active until end of Month 2.

## D-006 — Full FSD autonomy by default

**Date:** 2026-04-30
**Decision:** Posts go live automatically. Hashtag (Ivan/Maria) is the human review for the first 2 weeks per brand. Client never reviews — they get a fully managed service per Ivan's delivery model (#2).
**Why:** Aligns with Ivan's paramount point #6 (FSD-default with human override). Aligns with #2 (client doesn't touch the system). Approval flows would kill the delivery promise of a fully managed service. Hashtag-side QA is sufficient given that the QG step is rigorous and per-brand prompts are tuned during onboarding.
**Alternatives rejected:**
- Per-post client approval — kills the "fully managed" delivery promise
- Weekly batch approval — adds latency and complexity for marginal safety gain

**Status:** Active. Ivan can add a `client_approval_required` flag per brand later if any client demands it.

## D-007 — n8n stays for triggers + Publisher + alerts

**Date:** 2026-04-30
**Decision:** Cron triggers, Telegram Notifier Hub, Pipeline Alert Hub, Publisher A6, and Scheduled Publisher A6c all stay in n8n. The Node service does NOT replace them.
**Why:** Already proven in production. Publisher A6 has the dual-account routing + the BUG-S58-1 fix (id=0 retry, container poll). n8n's native scheduling beats anything custom we'd build in 2 weeks. Telegram Hub is tiny and central — rebuilding gains nothing. "Don't rebuild what works" is the senior call.
**Alternatives rejected:**
- Move everything to the Node service — adds complexity (cron scheduler, IG publish logic, Telegram bot) with zero migration value
- Move only Publisher to Node — possible but not in MVP scope; Publisher is a known-good unit

**Status:** Active.

## D-008 — Per-brand secret encryption: app-level AES-256-GCM

**Date:** 2026-05-01
**Decision:** Encrypt per-brand secrets (IG long-lived tokens, Notion DB IDs, GA tokens, future LinkedIn tokens) with **AES-256-GCM at the application layer** using a single `MASTER_ENCRYPTION_KEY` env var on Railway. Ciphertext stored as `bytea` in Supabase. Stored format: `iv (12 bytes) || ciphertext || authTag (16 bytes)`, base64-encoded for Postgres-friendliness in `text` columns; binary `bytea` for true blob columns. Helper module: `src/lib/crypto.ts` exports `encrypt(plaintext: string): string` and `decrypt(ciphertext: string): string`.

**Why:**
- Database never sees the encryption key OR the plaintext — DB compromise alone yields only ciphertext (vs. `pgcrypto` where the key must be passed in at query time, exposing both via query logs / replication / backups).
- Decryption logic centralized in one Node module → easy to test, easy to audit, easy to swap.
- Keeps Supabase a "dumb store" — no Postgres extension dependency, painless to migrate to a different DB if needed.
- Node's built-in `crypto` module is sufficient (no extra deps).

**Risk acknowledged:** If the Railway env leaks (`MASTER_ENCRYPTION_KEY` exposed), all per-brand secrets decryptable. Same risk class as `pgcrypto` with a key-in-env strategy — neither approach escapes it.

**Alternatives rejected:**
- **`pgcrypto` (DB-side)** — exposes both key and plaintext to the DB layer; tighter coupling to Postgres.
- **AWS KMS / GCP KMS / HashiCorp Vault** — the *correct* upgrade path post-MVP. Keys never touch our env, decrypt happens via signed API call. Skipped for MVP because adding a third-party dependency on Day 2 burns ~half a day for marginal week-1 benefit. Worth doing once we have ≥3 paying brands.

**Operational notes:**
- `MASTER_ENCRYPTION_KEY` must be 32 bytes (AES-256). Generate via `openssl rand -base64 32` → ~44-char base64 string. Decoded inside Node.
- Rotation procedure (when needed): mint new key → re-encrypt all `brand_configs` rows in a migration script → cut over env var → revoke old key. Doable but downtime-flavored; design for it but don't automate in MVP.
- IV must be unique per encryption (use `crypto.randomBytes(12)`). Never reuse an IV with the same key.

**Post-MVP upgrade path:** AWS KMS or GCP KMS — replace `MASTER_ENCRYPTION_KEY` with a KMS key ARN; `encrypt`/`decrypt` become async API calls. Schema unchanged.

**Status:** Active.

## D-009 — Brand identity stored as `jsonb`, mirrored from Notion

**Date:** 2026-05-01
**Decision:** `brand_configs.brand_identity` is a single `jsonb` column that holds the full creative+identity envelope (themes, pillars, image rules, blueprints, recipes, CTAs, hooks, lexicon, photo config, plus anything added later). Notion remains the **only** human-editable surface for brand identity. The jsonb is a passive machine-readable mirror.

**Why:** Discovery on Day 2 surfaced that Hashtag's brand identity is composed of **9 separate Notion databases**, all keyed by a `Client` select field (Brand Themes, Pillars, Image Strategy Rules, Blueprints, Content Recipes, CTA Bank, Hook Bank, Lexicon, Photo Config). The original schema had 5 fixed creative columns (`voice`, `pillars`, `banned_words`, `target_audience`, `hashtag_strategy`) which captured maybe 20% of that and could never accommodate evolution (e.g., when Maria/Ivan add a new identity dimension like "tone-by-customer-stage" or "seasonal-photography-direction", typed columns would force ALTER TABLE → migration → redeploy → friction).

Per Ivan #1 ("the human needs control of the brand and it can't live inside some prompt or json file"), Notion stays the human control surface. The jsonb is just an efficient cache for the pipeline. Humans never touch the jsonb directly.

**Alternatives rejected:**
- **Typed columns** — 80% of Hashtag's existing identity dimensions don't fit; future-additions block on me.
- **Many narrow tables (one per Notion DB)** — over-engineered for MVP; queries become 9-way joins with no operational gain (the pipeline always wants the full envelope at once).
- **Read directly from Notion per-pipeline-run** — see D-010; rejected for latency, rate limits, and outage-fragility.

**Status:** Active.

## D-010 — Brand identity sync: 5-min cached pull from Notion, on-demand refresh endpoint

**Date:** 2026-05-01
**Decision:** A sync job (lives in the Node service, runs every 5 minutes per active brand) reads all 9 Notion DBs filtered to the brand's `Client` value, assembles the canonical jsonb envelope, and upserts into `brand_configs.brand_identity` (also setting `brand_identity_synced_at`). The pipeline reads `brand_identity` from Postgres, never directly from Notion.

A `POST /admin/refresh-brand/:slug` endpoint forces an immediate sync — used by Ivan/Maria when iterating live ("I just changed the photo style, pull it now").

**Why:**
- **Latency:** Postgres read is sub-1ms; 9 Notion API calls per pipeline-run would add ~1.5–2s overhead.
- **Rate limits:** Notion's API is 3 req/s per integration. With N brands × 9 DBs × posts-per-day, we'd hit limits at ~10 brands.
- **Resilience:** Pipeline keeps running through Notion API outages (uses last-synced jsonb).
- **Latency-of-edit acceptable:** 5 minutes is fast enough that Ivan/Maria don't feel lag during creative work; on-demand endpoint covers the "I want it NOW" case.

**Operational notes:**
- Sync job emits one Sentry breadcrumb per sync per brand. Failure routes to Telegram Notifier Hub.
- `brand_identity_synced_at` exposed in `/health` per brand → fast diagnosis if a brand's identity is stale.
- If Notion sync fails for a brand, the pipeline still uses the last good jsonb (gracefully stale), but the brand is flagged in `/health` and Telegram-alerted after 30 min stale.

**Alternatives rejected:**
- **Live-read on every pipeline run** — see latency / rate-limit math above.
- **Webhook-driven (Notion → us)** — Notion doesn't ship reliable webhooks for DB-row changes; would need to be an Automation, which is brittle.
- **Manual "press to sync" only** — kills the "edit in Notion → next post uses it" promise.

**Status:** Active. Sync job implementation = Day 5.

## D-011 — IG token rotation deferred to Day 7 evening (atomic session)

**Date:** 2026-05-01
**Decision:** The Hashtag Agencia FB page token (`fb_page_token_2`) needed to publish on `@agenciahashtag_` is currently dead per BUG-S58-4. Token rotation is **not** done as part of Day 2; it gets its own atomic session on Day 7 evening, immediately before Day 8 begins (per-brand publishing).

**Why:**
- The Node service does NOT publish to IG until Day 8. Publisher A6 in n8n owns publishing through Days 2–7 with its own (separate) token reference.
- Token rotation = ~25–40 min OAuth dance via Graph API Explorer, prone to failure modes that need focused attention (per existing memory note: "atomic session").
- Doing it Day 2 burns Day-2 momentum on something that unlocks nothing for 5 days.
- Doing it Day 7 evening means the freshly-rotated 60-day token is at full lifespan when Day 8 publishing begins.

**Status:** Active. Reminder belongs in TODO.md "Day 7" entry.
