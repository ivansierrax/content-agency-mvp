# RESUME PROTOCOL — content_agency_mvp

> The 4-token resume system. Designed to eliminate "10% of context spent on the prompt" forever.

---

## Tightest possible resume prompt

Paste this in any new session:

```
[MVP] resume
```

That's 4 tokens. Costs ~$0 of your conversation context.

---

## What happens when Claude sees `[MVP] resume`

1. Master `Claude/CLAUDE.md` recognizes `[MVP]` as the project trigger.
2. Claude silently reads in order:
   1. `content_agency_mvp/CLAUDE.md` (project posture + load order)
   2. `content_agency_mvp/STATUS.md` (where we are)
   3. `content_agency_mvp/TODO.md` (what's next)
   4. `content_agency_mvp/SESSION_LOG.md` (last entry only — for context, not full history)
3. Claude responds with:
   - One-line "where we are" summary (from STATUS.md)
   - Top 3 next actions (from TODO.md "Right now")
   - Asks "ready to proceed?" — or proceeds directly if the next action is obvious and Ivan's intent is clear

These reads consume Claude's context window (which is huge), NOT yours. You stay efficient.

---

## Variants for specific situations

| Prompt | What happens |
|---|---|
| `[MVP] resume` | Default. Read state, summarize, propose next action. |
| `[MVP] status` | Read state, report status only, do NOT propose action. |
| `[MVP] continue Day N` | Explicit day-N pickup if STATUS.md is unclear or we want to skip ahead. |
| `[MVP] decision: <text>` | Log a new architectural decision (D-###) to DECISIONS.md before proceeding. |
| `[MVP] block: <text>` | Log a blocker to STATUS.md, ask Ivan for the unblock. |
| `[MVP] done Day N` | Close out the day. Updates STATUS.md, appends SESSION_LOG, surfaces next-day tasks in TODO.md. |
| `[MVP] issue: <text>` | Log a new bug/gotcha to KNOWN_ISSUES.md as ISSUE-###. |
| `[MVP] re-plan` | Force re-read of PLAN.md + DECISIONS.md. Use if scope feels off. |

---

## End-of-session protocol (Claude does this automatically)

Triggered when:
- Ivan types `[MVP] done Day N`, OR
- The session is wrapping (Ivan signals stop, last task complete, or context approaching limit)

Claude runs:
1. Append a `SESSION_LOG.md` entry (what happened, what's next, blockers, open questions, files touched)
2. Update `STATUS.md` (current state — health table, last session, next session)
3. Update `TODO.md` (move done items out, surface tomorrow's tasks)
4. If a new architectural decision was made → append D-### to `DECISIONS.md`
5. If a new bug/landmine surfaced → append ISSUE-### to `KNOWN_ISSUES.md`

---

## Why this is token-efficient (the math)

| Approach | Tokens per session-start | Cost per session (assuming Sonnet) |
|---|---|---|
| Pasting plan + status into prompt | ~5,000-10,000 | ~$0.015-$0.030 |
| `[MVP] resume` + Claude tool-reads files | ~10 user-paste + ~3,000 Claude-context | ~$0 user-paste + ~$0.009 Claude |

Over 14 sessions, the savings are real but smaller than they feel. **The bigger win is mental: Ivan doesn't think about state-passing. Claude doesn't ask "what are we working on."** The state-loading is invisible.

---

## Failure modes this protocol prevents

| Failure mode | What prevents it |
|---|---|
| "I have to re-explain the project every session" | State files do it. |
| "Pasting context burns 10% of conversation" | 4-token trigger replaces paste. |
| "Claude reverts to junior mode" | `~/.claude/CLAUDE.md` Operating posture + project posture inheritance. |
| "Plans drift between sessions" | DECISIONS.md is append-only; nothing changes silently. PLAN.md is locked. |
| "Where are we?" takes 10 minutes | STATUS.md is one screen. |
| "Did we already decide X?" | DECISIONS.md is grep-able. |
| "Is this bug new or known?" | KNOWN_ISSUES.md captures both inherited landmines and new issues. |

---

## When the protocol should be revised

- After 5 sessions, audit: did the auto-load order surface the right things? Adjust `CLAUDE.md` load order if any file was loaded but never useful.
- If Ivan finds himself re-explaining anything, that's a STATUS.md or SESSION_LOG.md gap → fix the file template.
- If Claude proposes the wrong next action on resume, that's a TODO.md gap → tighten the "Right now" section.

---

## Integration with global memory

`MEMORY.md` (auto-memory at `~/.claude/projects/.../memory/`) gets a one-line pointer to this project. Claude finds it automatically across all sessions, even ones that don't include the `[MVP]` trigger.
