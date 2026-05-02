# IG Token Rotation Runbook

**Authoritative procedure for rotating a Hashtag-managed IG/FB Page token (D-011).**

When you finish this runbook, `brand_configs.ig_token_encrypted` for the named
brand holds a fresh long-lived (≥50 day) Page token. Day 8 publishing is unblocked.

> History: BUG-S58-4 (April 2026 production) — silent token expiry cost ~7 days
> of lost form leads. Treat tokens as fragile; verify with `debug_token` after
> every rotation.

## Why this is manual (and not in the onboarding CLI)

The OAuth dance via Graph API Explorer requires:
- Ivan's Facebook account password
- Ivan's MFA second factor (SMS / authenticator)
- Granting scopes interactively

None of these can or should be automated. The CLI takes the freshly-minted
token as a CLI arg and handles the encryption + DB write only.

## Procedure (~15-20 min)

### 1. Generate a fresh long-lived Page token

a. Open https://developers.facebook.com/tools/explorer/

b. Top-right "Meta App" dropdown → select `Hashtag Agencia` (or whichever app
   owns the Page).

c. "User or Page" dropdown → select **the Page itself**, NOT the user. (If you
   pick User, the token has user-scope and cannot publish to the Page.)

d. Click "Generate Access Token".

e. Approve scopes — at minimum:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `instagram_basic`
   - `instagram_content_publish`

f. Copy the token from the "Access Token" field. This is a **short-lived**
   token (~1 hour TTL). Continue to step 2 to exchange for a long-lived one.

### 2. Exchange for a long-lived (60-day) Page token

```bash
SHORT_TOKEN="<paste from step 1>"
APP_ID="<your FB app ID>"
APP_SECRET="<your FB app secret>"

# (a) Exchange short-lived USER token for long-lived USER token
curl -s "https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=$APP_ID&client_secret=$APP_SECRET&fb_exchange_token=$SHORT_TOKEN" | jq

# (b) The output gives you a long-lived USER token. Use it to fetch
#     long-lived PAGE tokens via /me/accounts:
LONG_USER_TOKEN="<from step 2a>"
curl -s "https://graph.facebook.com/v21.0/me/accounts?access_token=$LONG_USER_TOKEN" | jq

# (c) Copy the `access_token` field of the Page you want — that's the
#     long-lived (60-day) Page token. Save it as $PAGE_TOKEN below.
```

### 3. Verify with debug_token

```bash
PAGE_TOKEN="<from step 2c>"
curl -s "https://graph.facebook.com/debug_token?input_token=$PAGE_TOKEN&access_token=$PAGE_TOKEN" | jq

# Expect:
#   data.is_valid: true
#   data.type: "PAGE"
#   data.expires_at: ~60 days from now (unix seconds)
#   data.scopes: includes pages_manage_posts + instagram_content_publish
```

If `is_valid:false` or `expires_at` is missing / soon → **STOP**. Re-do step 1
with the correct App + Page selection.

### 4. Store via the CLI

```bash
# From the content_agency_mvp/ directory, with .env loaded (or env vars exported):
npm run store-ig-token -- --slug=hashtag --token="$PAGE_TOKEN" \
  --ig-account=<ig_business_account_id> --fb-page=<fb_page_id>

# This:
#   - looks up brand by slug
#   - calls debug_token AGAIN to double-verify (≥50 days remaining)
#   - encrypts via AES-256-GCM (MASTER_ENCRYPTION_KEY)
#   - UPDATEs brand_configs.ig_token_encrypted (+ optional ig_business_account_id, fb_page_id)
#   - prints the human commit-log line you'll paste into CREDENTIALS.md
```

If verify rejects the token (`expires_at < 50 days from now`), the CLI exits
non-zero and prints the reason. Pass `--no-verify` ONLY if you've already
manually confirmed and Graph API is rate-limiting you.

### 5. Log the rotation

In CREDENTIALS.md, append a row to the "Rotation log" table:

```
| 2026-05-08 | Hashtag IG Page token | rotated to fresh 60-day | D-011 atomic session |
```

In the active SESSION_LOG.md entry, add:

```
- IG token rotated for `hashtag` (D-011 complete). Fresh Page token, expires_at = 2026-07-07.
```

Commit both files. **This is the evidence trail the 2026-05-09 verification
agent (trig_017kbLj7ju1Q8Aq7d2WBh5c8) checks.**

## Common failure modes

- **Wrong "User or Page" selection in step 1c.** User-scoped token cannot
  publish to the Page. `debug_token` shows `type: "USER"` instead of `"PAGE"`.
- **Short-lived token only (skipped step 2).** `debug_token.expires_at` is ~1
  hour out. Won't pass the CLI's 50-day check.
- **Missing `instagram_content_publish` scope.** Token works for fetches but
  publish calls return permission errors. `debug_token.scopes` shows the lack.
- **App in dev mode only.** If the app hasn't been reviewed for advanced
  permissions, scopes are limited to admins. Hashtag's app should already be
  through review per existing n8n production usage.

## Cadence

Tokens expire at 60 days. Rotate at **day 50** to leave a 10-day safety margin.
The scheduled verification agent (trig_017kbLj7ju1Q8Aq7d2WBh5c8) catches this
once on 2026-05-09; for ongoing rotations, schedule a recurring monthly agent
on the first of each month to re-verify.
