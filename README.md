# content-agency-mvp

Multi-tenant AI content agency platform. Ships daily Spanish-language Instagram content for SMB clients. Hashtag Agencia operates the system; clients never touch it (full-FSD service model).

## Status

**Day 1 — Bootstrap (in progress, 2026-04-30).** See `STATUS.md` for current state and `PLAN.md` for the locked 14-day roadmap.

## What this is

- Node.js + TypeScript service that runs the content production chain (Strategist → Writer → Editor → Spanish-Editor → QG → Designer) for many brands, partitioned by `brand_id`.
- Reads brand config from Supabase (Postgres), sourced from per-brand Notion DBs.
- Hands off to existing n8n Publisher A6 for IG scheduling + posting.
- Reuses the existing `content_pipeline/eval/run.mjs` prompt logic — port-then-refactor (see `DECISIONS.md` D-003).

## What this is NOT

- Not a SaaS product clients log into.
- Not LinkedIn-ready in MVP (weeks 3-4).
- Not autonomous-learning in MVP (weeks 5-6).
- Not English/multi-language in MVP (Spanish only).
- See `PLAN.md` "OUT" section for the full deferred list.

## Quickstart (local dev)

```bash
# Requires Node 20+
npm install
cp .env.example .env       # fill in real values from CREDENTIALS.md (gitignored)
npm run typecheck
npm run smoke              # runs src/index.ts — currently just Sentry init + hello
```

## Project layout (will fill out across Days 1-10)

```
content_agency_mvp/
├── src/
│   ├── index.ts            # entry point
│   ├── lib/
│   │   ├── env.ts          # validated env loader
│   │   ├── sentry.ts       # Sentry init
│   │   ├── supabase.ts     # Supabase client
│   │   └── anthropic.ts    # Anthropic client + prompt caching helper
│   ├── pipeline/           # Day 3+ — Strategist → Writer → Editor → SE → QG
│   ├── designer/           # Day 4 — HCTI + Gemini + GCS proxy
│   ├── notion/             # Day 5 — per-brand config sync
│   └── eval/               # Day 1+ — local prompt-iteration harness (ports run.mjs)
├── docs/                   # Day 9 — runbook, add-brand procedure, architecture
├── PLAN.md                 # 14-day plan (locked at Day 0)
├── STATUS.md               # current state — updates every session
├── TODO.md                 # next-action list — updates every session
├── SESSION_LOG.md          # append-only history
├── DECISIONS.md            # architectural decisions (D-001+)
├── KNOWN_ISSUES.md         # bugs + landmines
├── RESUME.md               # session-resume protocol
├── CREDENTIALS.md          # gitignored — secrets registry
├── CLAUDE.md               # session instructions for Claude Code
├── .env.example            # template for .env
└── .gitignore
```

## Rules from `content_pipeline/CLAUDE.md` that apply here

- **Product first.** Never embed brand, voice, or pillars in code or prompts. Anything that varies per client lives in Supabase + Notion.
- **Generator stays dumb.** Each pipeline step receives a fully-prepared input and returns structured JSON. No live Notion queries, no source fetching, no rotation logic inside the LLM steps.
- **Every guideline has an enforcer.** If there's a rule no agent validates, it doesn't exist. Add the check or delete the rule.
- **Credentials never in code.** Env vars only. `.env` and `CREDENTIALS.md` are gitignored.
- **Traceability.** Every post carries a correlation ID from start to publish. Every rejection carries a machine-parseable reason code.

## Status protocol

- Start any new Claude Code session with `[MVP] resume` (see `RESUME.md`).
- End any session by updating `STATUS.md` + `TODO.md` + appending to `SESSION_LOG.md`.

## License

Private. © Hashtag Agencia.
