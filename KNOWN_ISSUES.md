# KNOWN_ISSUES — content_agency_mvp

> Bugs, gotchas, and "watch out for" entries. Append as we hit them.
> Format: ISSUE-### · date · severity · description · workaround · root cause · status.

---

## Live issues

### ISSUE-001 — Railway "Update Variables" button is misleading in Suggested Variables panel
- **Symptom:** Clicking "Update Variables" in Railway's Suggested Variables panel APPEARS to save but doesn't persist them — vars come back empty after page refresh. Service crashes on first deploy with `Missing required env var: ...`
- **Severity:** WARNING (cost ~10 min on Day 1 build; auto-recovers after second attempt)
- **Root cause:** "Update Variables" only updates form state; "Add" button is the actual persist action. UX bug in Railway dashboard.
- **Fix:** Use the **"Add"** button in the Suggested Variables panel (NOT "Update Variables"). OR install Railway CLI (`brew install railway` + `railway login`) and use `railway variables --set KEY=VALUE` — deterministic.
- **Prevention rule:** Next time setting Railway vars, use CLI from day one OR verify by refreshing the page after click — if vars come back empty, click "Add" instead of "Update Variables."

### ISSUE-002 — Railway Deploy button click via JS doesn't reliably trigger redeploy
- **Symptom:** Clicking the "Deploy ⇧+Enter" button via JS (`btn.click()`) doesn't trigger a new build. Status stays on previous CRASHED state.
- **Severity:** INFO (workaround easy)
- **Root cause:** Railway's deploy button is keyboard-shortcut-driven (Shift+Enter), not click-driven for some flows.
- **Fix:** After ensuring env vars are saved, use keyboard shortcut: click anywhere on the service page first to focus, then send `Shift+Enter`. New build kicks off in <2 seconds.
- **Prevention rule:** For programmatic Railway control, use Railway CLI (`railway up`) instead of dashboard automation.

### ISSUE-003 — Old crash logs persist on Railway page after successful redeploy
- **Symptom:** After fixing the env-var issue and redeploying, the project page still shows error strings from the previous crash ("Missing required env var: SENTRY_DSN") in deployment logs section. Easy to think the new deploy is also failing.
- **Severity:** INFO (cosmetic/observability)
- **Root cause:** Railway shows historical deploy logs alongside live status; whole-page string search picks up both.
- **Fix:** Always check the LATEST deployment tile's status indicator (ACTIVE / BUILDING / CRASHED), not whole-page text. Or use `railway logs` CLI for current deploy only.
- **Prevention rule:** When verifying deploy status programmatically, target the specific latest-deploy DOM element, not body text.

---

## Pre-known landmines (inherited from existing pipeline experience — already mitigated in plan)

---

## Pre-known landmines (inherited from existing pipeline experience — already mitigated in plan)

These don't need debugging — they need carrying-forward. The Node service inherits their fixes from `content_pipeline/canonical/` and `feedback_n8n_architecture.md`.

### LM-1 — HCTI 5-10% transient TLS errors (`ECONNRESET` / `aborted`)
- **Symptom:** Random ~5-10% of HCTI Download PNG calls fail mid-stream.
- **Mitigation:** Retry with backoff + `onError: continueRegularOutput` pattern. In Node service: explicit `axios-retry` config or fetch wrapper with 3 retries × 2s backoff.
- **Inherited from:** `feedback_n8n_architecture.md` rule #26.

### LM-2 — IG carousel `id=0` silent failure
- **Symptom:** POST `/{ig_id}/media media_type=CAROUSEL` returns HTTP 200 with `{"id":"0"}` if called too soon after children are created (~5-8s window).
- **Mitigation:** Retry on `id="0"` (6 attempts × 5s backoff). Plus poll container `status_code` until FINISHED before `media_publish`.
- **Inherited from:** `feedback_n8n_architecture.md` rule #35; BUG-S58-1 fix in canonical.

### LM-3 — IG carousel `2207032` ERROR at content moderation
- **Symptom:** Container reaches FINISHED but actual `media_publish` returns content-moderation error 2207032 "Media upload has failed."
- **Mitigation:** Catch + return clean error to Notion `Feedback`. Don't burn anti-spam quota retrying.
- **Inherited from:** `feedback_n8n_architecture.md` rule #35.

### LM-4 — IG anti-spam throttle (~5 publish probes/account/hour)
- **Symptom:** `media_publish` returns 403 with code 4 / subcode 2207051. Token + content_publishing_limit look fine.
- **Mitigation:** Hard cap 5 publish attempts/account/hour during dev/diagnostic. Use eval harness diagnostic mode (no `--publish`) for chain testing.
- **Inherited from:** `feedback_n8n_architecture.md` rule #37.

### LM-5 — FB page tokens silently invalidated
- **Symptom:** Token marked `expires_at: 0` ("permanent") goes `is_valid: false` due to password reset / security review / app review change. Surfaces only on next publish attempt.
- **Mitigation:** Daily `debug_token` check per brand (carry forward A8 pattern). Alert via Telegram on `is_valid: false`.
- **Inherited from:** `feedback_n8n_architecture.md` rule #32; BUG-S58-4 lineage.

### LM-6 — Notion programmatic DB creation doesn't share with other integrations
- **Symptom:** Creating a Notion DB via integration X means integration Y returns 404. Sharing is UI-only.
- **Mitigation:** Master template approach — duplicate an already-shared template DB rather than creating fresh.
- **Inherited from:** `feedback_n8n_architecture.md` rule #25.

### LM-7 — IG can't fetch from `lh3.googleusercontent.com`
- **Symptom:** All lh3 URLs fail IG container creation with code 9004/2207052.
- **Mitigation:** GCS proxy bucket (`gs://hashtag-ig-proxy`). Already implemented; carry forward.
- **Inherited from:** `feedback_n8n_architecture.md` rules #21, #23.

### LM-8 — n8n Code node 60s timeout (eliminated by leaving n8n)
- **Note:** This is the symptom the whole MVP exists to fix. The Node service has no Code-node sandbox; standard Node async/await runs as long as it needs.

### LM-9 — `"VERBATIM paste"` strings break JSON when they contain `"`
- **Symptom:** Writer/Editor JSON output corrupted when CTA Bank contains literal double-quotes.
- **Mitigation:** Audit CTA Bank for `"` characters. Use ALL CAPS / chevrons / brackets for emphasis instead. Never trust LLM to escape correctly.
- **Inherited from:** `feedback_n8n_architecture.md` rule #28.

### LM-10 — n8n credential `httpNode` toggle defaults OFF
- **Note:** Not relevant to Node service (we use API keys directly), but if we touch any n8n workflow, watch for this.

---

## Likely failure modes for the new Node service (predictions, will become real ISSUE-### entries)

These are guesses based on similar projects. Treat as "watch for these in week 2."

- **Supabase connection pool exhaustion** under cron-fan-out (multi-brand parallel calls) — mitigate with explicit pool size in client config.
- **Railway cold start latency** if cron is infrequent — mitigate with `Always On` setting (paid feature) or keep-alive ping.
- **Notion 5-min sync race condition** if Maria edits a brand_config WHILE pipeline is running — mitigate with optimistic concurrency + retry.
- **Sentry sampling cost** if we don't set sample rates — start with 100% errors + 10% transactions.
- **First-brand prompt drift** — Brand 1's voice might surface in Brand 2 if config inheritance is sloppy. **Per-brand circuit breaker test on Day 6 is critical.**
