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
