# content_agency_mvp — Multi-Tenant AI Content Agency MVP

> Project triggers (master `Claude/CLAUDE.md` routes any of these here):
> `[MVP]`, `MVP`, `content agency MVP`, `the MVP`, `agency platform`, `multi-tenant`

## Project posture (inherits global ~/.claude/CLAUDE.md "Operating posture" — senior staff engineer)

**Goal:** Ship a 14-day MVP that lets Hashtag Agencia run daily AI content for paying SMB clients (CDMX/GDL/MTY) at $25-35K MXN/month. IG only. Spanish only. Full FSD autonomy. Reliable enough to charge.

**Scope is locked at planning (2026-04-30).** No additions without an explicit `[MVP] decision: ...` log to DECISIONS.md. If Ivan asks for "one more feature" mid-build, push back: name the cost in days, name what gets cut to make room.

## Auto-load order (silent, before responding)

1. `STATUS.md` — current state
2. `TODO.md` — what's next
3. `SESSION_LOG.md` — last entry only (for context, not full history)
4. `DECISIONS.md` — only if the question touches architecture
5. `KNOWN_ISSUES.md` — only if the question touches something that broke before
6. `PLAN.md` — only if Ivan explicitly asks about timeline / day-N scope

## End-of-session protocol (run automatically when Ivan says `[MVP] done` or session is wrapping)

1. Append a SESSION_LOG.md entry: what happened, what's next, blockers, open questions
2. Update STATUS.md to reflect new state
3. Update TODO.md (move done items out, surface tomorrow's tasks)
4. If a new architectural decision was made → append D-### to DECISIONS.md
5. If a new bug/landmine surfaced → append to KNOWN_ISSUES.md

## Cost discipline

- **Sonnet 4.6** for routine work (file edits, code, debugging known patterns)
- **Opus 4.7** only when judgment matters (architecture, ambiguous tradeoffs, planning)
- All Anthropic SDK calls in the production pipeline use **prompt caching** on system prompts (`cache_control: {type: 'ephemeral'}`). Caching kills ~80% of token cost on the chain's repeated system prompts.

## Boundaries (don't drift into these without explicit decision log)

- ❌ LinkedIn integration (deferred to weeks 3-4)
- ❌ Learning loop (deferred to weeks 5-6)
- ❌ Admin UI for Ivan/Maria (Notion-per-brand is the v1 control surface)
- ❌ Client-facing dashboard (clients never touch the system; full-FSD service model)
- ❌ Cross-brand data sharing (each brand fully isolated per Ivan #10)
- ❌ Languages other than Spanish (Mexican Spanish only for MVP)

## Inheritance from existing systems

- `content_pipeline/eval/run.mjs` is the **engine foundation**. Port-then-refactor; don't rewrite.
- `content_pipeline/canonical/` is the **prompt/code source-of-truth**. Always sync changes back here.
- `engineering_decisions.md` rules apply (n8n patterns, IG carousel quirks, FB token rotation, etc.).
- `feedback_n8n_architecture.md` 50+ patterns are still load-bearing — read them when a relevant problem surfaces.

## What stays in n8n (don't migrate)

- Cron triggers (n8n's scheduling beats anything we'd build)
- Telegram Notifier Hub (`SDgpvcwCoybslBB2`) — already proven
- Pipeline Alert Hub (`udMthSQycVX6APfr`) — already proven
- Publisher A6 (`8jSmVKk7ezw1s5No`) — has dual-account routing + BUG-S58-1 fix
- Scheduled Publisher A6c (`Fo59cRc6tJEgogwo`)

## What we're building

A Node.js + TypeScript service ("content_agency_mvp") that:
- Reads brand_config from Postgres (Supabase) — sourced from per-brand Notion DBs
- Runs the Strategist→Writer→Editor→Spanish-Editor→QG→Designer chain parameterized by brand_id
- Writes `image_generated` posts back to per-brand Notion content queue
- Hands off to Publisher A6 (n8n) for scheduling + IG publish

## Reliability standards (non-negotiable, per Ivan #8 "can't keep breaking")

- Every external API call wrapped in retry+timeout+circuit-breaker
- Idempotency keys on every post operation (no double-posts ever)
- Per-brand circuit breakers (Brand A failure must not affect Brand B/C)
- Sentry hooks at every critical step
- Health check endpoint: `/health` returns per-brand status
- All errors route to existing Telegram Notifier Hub
- Zero silent failures — every error must surface to a human within 60s
