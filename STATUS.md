# STATUS — content_agency_mvp

**Day 7 (2026-05-02 CST) — ✅ AUTOMATABLE PORTION DONE. Multi-brand isolation verified clean for creative inventory. Onboarding CLI + token-store CLI built and tested. IG token rotation runbook written. The Hashtag IG token rotation itself is BLOCKED on Ivan running the runbook (manual OAuth + MFA, ~15-20 min) — the scheduled verification agent on 2026-05-09 09:00 CST (`trig_017kbLj7ju1Q8Aq7d2WBh5c8`) will check the evidence trail.**

## Where we are

End of Day 7's automatable portion. The agency platform now has the operational tooling to onboard new brands safely:

- ✅ Day 1-6: HTTP server, data layer, full text+image chain, Notion sync, Designer.
- ✅ **Day 7 (Session 7):**
  - **Multi-brand isolation test:** synthetic Brand 1 ('testbrand', empty identity) reached `status='ready'` in 123s. Strategist picked Sonnet-improvised names with all Postgres IDs null. No leak from Brand 0's curated inventory. `brand_id`-keyed reads work as designed.
  - **Architectural finding (not a bug):** Notion data_sources query rejects unknown `Client` select option values with HTTP 400. The onboarding CLI must verify the option exists before inserting Postgres rows.
  - **Onboarding CLI** (`scripts/onboard-brand.ts`, ~200 LOC): preflight check across all 8 Notion DBs → idempotent `brands` + `brand_configs` upserts → trigger first sync → report counts+warnings. Failure path tested (exit 3, prints fix instructions).
  - **Token-store CLI** (`scripts/store-ig-token.ts`, ~150 LOC): brand lookup → Graph API `debug_token` verify (is_valid + ≥50 days remaining) → AES-256-GCM encrypt → DB update. `--no-verify` escape hatch for rate-limit retries.
  - **IG token rotation runbook** (`runbooks/ig-token-rotation.md`): full OAuth-dance recipe from Graph API Explorer through long-lived token exchange to CLI store. Common failure modes documented.
  - **`testbrand` archived** (status=paused, archived_at set, notion_client_filter cleared) so cron sync skips it cleanly.
  - **Soft theme-leak finding logged for Day 9:** Brand 1's rendered slides showed 'HASHTAG AGENCIA' header/footer because the default theme fallback is Hashtag-hardcoded. NOT a creative-inventory leak; not blocking. Day 9 reliability: brand-correct theme fallback when `brand_identity.themes` is empty.

## What's blocked on Ivan (Day 7 PM)

- ⏳ **Hashtag IG token rotation (D-011).** Ivan must run the runbook manually:
  1. Open Graph API Explorer, generate fresh short-lived Page token with required scopes.
  2. Exchange for long-lived 60-day Page token via `/oauth/access_token` + `/me/accounts`.
  3. `debug_token` to verify is_valid + 60-day expiry.
  4. `npm run store-ig-token -- --slug=hashtag --token=<token> --ig-account=<id> --fb-page=<id>`
  5. Append rotation log line to CREDENTIALS.md + SESSION_LOG.md, commit.
- The scheduled verification agent (`trig_017kbLj7ju1Q8Aq7d2WBh5c8`, fires 2026-05-09T15:00:00Z) will read the evidence trail and ping if rotation didn't happen.

## What we don't have yet (Day 8+)

- ⚪ **IG Graph API publishing path** — Day 8. Consume `WriterDraft.slides[].url` (Supabase public PNG URLs) → IG `/me/media` create → `/me/media_publish` flip. Carousel media-container child sequencing per IG semantics. Anti-spam throttle (≤5 publish probes/account/hour during dev).
- ⚪ **Reliability hardening** Day 9.
- ⚪ **E2E + first real brand onboarded** Day 10.

## Health

| Component | Status |
|---|---|
| Plan | 🟢 |
| Architecture | 🟢 15 active decisions (D-001 through D-015) |
| Code | 🟢 full text+image chain + onboarding/token CLIs live, typecheck clean |
| Infrastructure | 🟢 Railway → Sentry → Supabase (DB + Storage) → Anthropic + Notion + Gemini + HCTI |
| Brand 0 (Hashtag) | 🟢 FULL identity synced; **awaiting IG token rotation (manual)** |
| Multi-brand isolation | 🟢 verified clean for creative inventory |
| First fully-rendered carousel | 🟢 (Day 6) |
| Onboarding CLI | 🟢 (Day 7) |
| **IG token rotation** | ⏳ **BLOCKED on Ivan running the runbook** |
| Per-brand publishing | ⚪ Day 8 target |
| First real brand onboarded | ⚪ Day 10 target |
| Live with paying brand | ⚪ Day 11-14 target |

## Current blockers

- **Hashtag IG token rotation** — manual OAuth dance per `runbooks/ig-token-rotation.md`. Day 7 PM atomic session. Day 8 publishing cannot start without this.

## Last session

**2026-05-02 CST (Session 7 — Day 7 automatable portion DONE):**

1. **Multi-brand isolation test** — inserted synthetic Brand 1 directly via Supabase REST (slug='testbrand', notion_client_filter='TestClient', brand_identity={}). Triggered `/admin/refresh-brand/testbrand` — surfaced architectural finding: Notion data_sources query returns HTTP 400 with helpful "Available options: 'Hashtag'" hint when select option doesn't exist. **NOT a bug** — the right contract; logged as onboarding precondition.
2. **Pipeline run against Brand 1** (empty identity, sync skipped) reached `status='ready'` in 123s. **Strategist picked Sonnet-improvised names with all Postgres IDs null** — no Brand 0 leak. Brand-id-keyed reads from `brand_configs.brand_identity` work as designed.
3. **Soft theme-leak finding** — Brand 1's rendered slides showed 'HASHTAG AGENCIA' header/footer + `ivan@hashtag.com.mx` because `pickThemeColors()` falls back to hardcoded Hashtag values when `brand_identity.themes` is empty. NOT a creative-inventory leak; visual-only. Logged for Day 9.
4. **Onboarding CLI** built with the preflight as the first check. Tested both paths:
   - Good filter (`Hashtag`): all 8 DBs accept, idempotent on existing rows, sync ran in 1.3s for 80 rows. Re-run-safe.
   - Bad filter (`DoesNotExist`): all 8 DBs reject, prints "available options: Hashtag" cleanly + tells Ivan exactly what to do, exits code 3. No DB mutations on failure.
5. **Token-store CLI** built. `debug_token` verify enforces 50-day floor. AES-256-GCM encrypt via existing `crypto.ts`. UPDATE-only on `brand_configs.ig_token_encrypted` (+ optional ig_business_account_id, fb_page_id). Plaintext token never touches disk.
6. **IG rotation runbook** written (`runbooks/ig-token-rotation.md`). Full OAuth dance + common failure modes + cadence guidance (rotate at day 50 for 10-day safety margin).
7. **testbrand archived** (status=paused, archived_at, notion_client_filter cleared) so the 5-min cron sync doesn't 400 every 5 min on the dead filter.
8. **D-011 actual rotation: BLOCKED on Ivan** running the runbook. Cannot automate the OAuth + MFA dance. Scheduled verification agent (trig_017kbLj7ju1Q8Aq7d2WBh5c8) will catch it on 2026-05-09 09:00 CST.

**Day 7 done criterion** for the automatable scope met. The agency platform can now safely onboard a new brand with one CLI invocation (after the human has added the Notion select option). Token rotation is one CLI invocation away too — only the OAuth dance is human.

**Lessons (some belong promoted to feedback memory eventually):**
- **Failure-path testing surfaces real architecture findings.** I built the onboarding CLI with preflight INSTINCTIVELY because of the morning's Notion 400. If I'd skipped the isolation test (or only tested the happy path), I'd have shipped a CLI that fails opaquely on first onboarding attempt for any new brand. The 30 min spent on the isolation test paid for the next 50 brands' onboardings.
- **Soft visual leaks ≠ data leaks.** Brand 1's slides had Hashtag branding because the theme fallback is hardcoded. That's an embarrassment if shipped, but the data layer (creative inventory, IDs, brand_id) is clean. Naming this distinction publicly (in this STATUS) prevents future-me from over-reacting and gold-plating Day 7.
- **The runbook IS the work.** I cannot rotate the token, but I can make the rotation a 5-minute task instead of a 1-hour fumble. The runbook + CLI + verify-with-debug_token + 50-day floor is what actually de-risks BUG-S58-4 going forward.

**External state changes:**
- GitHub: 1 commit on main (`ed31557` Day 7 isolation test + CLIs + runbook). State-docs commit pending.
- Supabase: testbrand inserted, then archived/paused/filter-cleared. brand_identity column for testbrand set to `{}`.
- Railway: no new env vars. No deploys (CLIs are local-only / dev-only tools).
- One extra `post_queue` row from the isolation test (`12d02e0b-134b-4a34-bdbe-ca5a467b9695`, brand_id=testbrand-uuid, status=ready). Safe to leave for forensic value.

**New decisions logged:** None this session. Soft theme-leak finding queued for Day 9 (no D-### until I make the change).

## Next session

**Day 8 — IG Graph API publishing path.** Resume with `[MVP] resume`.

**Hard precondition:** Hashtag IG token rotation must be complete (Ivan runs the runbook + CLI). Verification agent fires 2026-05-09 09:00 CST and will alarm if not done.

First actions:
1. Read `engineering_decisions.md` IG-publish patterns (BUG-S58-4 / anti-spam throttle / carousel-vs-single ordering).
2. Build `src/pipeline/publisher.ts` — consume a `post_queue` row at `status='ready'`, call IG Graph API `/me/media` for each slide URL (carousel children) → `/me/media_publish` to flip the parent → write back ig_media_id + ig_permalink to `post_results`. Status flow: `ready → publishing → published`.
3. Reuse n8n's Publisher A6 (`8jSmVKk7ezw1s5No`) carousel ordering rules verbatim — already proven against BUG-S58-1 dual-account routing.
4. Add Day 8 cron: poll `post_queue` for `status='ready' AND scheduled_for <= now()` every 5 min, kick off publisher.
5. Smoke test: schedule the existing Day-6 Stack Overflow `post_queue_id` for 5 min in the future, confirm it auto-publishes to `@agenciahashtag_` (or `@hashtag_estudio` per dual-account routing).
