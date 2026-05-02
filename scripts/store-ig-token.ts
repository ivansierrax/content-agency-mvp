#!/usr/bin/env tsx
/**
 * Encrypt + store an IG/FB Page token for a brand. Used immediately after the
 * OAuth dance produces a fresh long-lived token (D-011 rotation procedure).
 *
 * Usage:
 *   npm run store-ig-token -- --slug=<slug> --token=<plaintext> [--ig-account=<id>] [--fb-page=<id>] [--no-verify]
 *
 * What it does:
 *   1. Validate the brand exists.
 *   2. Optionally call Graph API debug_token to verify the token is valid AND
 *      long-lived (≥50 days). Pass --no-verify to skip (e.g. for dry runs).
 *   3. Encrypt the plaintext via crypto.ts (AES-256-GCM, MASTER_ENCRYPTION_KEY).
 *   4. UPDATE brand_configs.ig_token_encrypted (+ optional ig_business_account_id, fb_page_id).
 *   5. Append a row to CREDENTIALS.md "Rotation log" via stdout instructions
 *      (CLI doesn't write the file — Ivan does it manually so the commit is intentional).
 *
 * Plaintext token is ONLY in memory + on the CLI argv. Never written to disk by this script.
 *
 * Environment requires: MASTER_ENCRYPTION_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY.
 */

import process from 'node:process';
import { loadEnv } from '../src/lib/env.js';
import { encrypt } from '../src/lib/crypto.js';
import { getAdminClient } from '../src/lib/supabase.js';

interface CliArgs {
  slug: string;
  token: string;
  igAccount?: string;
  fbPage?: string;
  verify: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string | true> = {};
  for (const a of argv.slice(2)) {
    if (a === '--no-verify') {
      args['no-verify'] = true;
      continue;
    }
    const m = a.match(/^--([a-zA-Z0-9-]+)=(.*)$/);
    if (m) args[m[1]!] = m[2]!;
  }
  if (typeof args['slug'] !== 'string' || typeof args['token'] !== 'string') {
    console.error('Missing required arg: --slug and --token');
    console.error('Usage: npm run store-ig-token -- --slug=<slug> --token=<plaintext> [--ig-account=<id>] [--fb-page=<id>] [--no-verify]');
    process.exit(2);
  }
  return {
    slug: args['slug'],
    token: args['token'],
    igAccount: typeof args['ig-account'] === 'string' ? args['ig-account'] : undefined,
    fbPage: typeof args['fb-page'] === 'string' ? args['fb-page'] : undefined,
    verify: args['no-verify'] !== true,
  };
}

interface DebugTokenResponse {
  data?: {
    is_valid?: boolean;
    type?: string;
    app_id?: string;
    user_id?: string;
    expires_at?: number; // unix seconds
    data_access_expires_at?: number;
    scopes?: string[];
    error?: { message?: string };
  };
}

async function debugToken(token: string): Promise<DebugTokenResponse> {
  const url = `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  return (await res.json()) as DebugTokenResponse;
}

function fmtUnixDate(s?: number): string {
  if (!s) return 'never';
  const d = new Date(s * 1000);
  return d.toISOString().substring(0, 10);
}

function daysFromNow(s?: number): number {
  if (!s) return Infinity;
  return Math.floor((s * 1000 - Date.now()) / (1000 * 60 * 60 * 24));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  loadEnv(); // throws if MASTER_ENCRYPTION_KEY etc. missing

  console.log(`[store-ig-token] starting: slug=${args.slug} (token redacted)`);

  // Step 1: brand exists?
  const client = getAdminClient();
  const { data: brandRow, error: brandErr } = await client
    .from('brands')
    .select('id, slug, name, status')
    .eq('slug', args.slug)
    .is('archived_at', null)
    .maybeSingle();
  if (brandErr) {
    console.error(`[store-ig-token] brand lookup failed: ${brandErr.message}`);
    process.exit(1);
  }
  const brand = brandRow as { id: string; slug: string; name: string; status: string } | null;
  if (!brand) {
    console.error(`[store-ig-token] brand not found: ${args.slug}`);
    process.exit(3);
  }
  console.log(`  ✓ brand found: ${brand.name} (id=${brand.id}, status=${brand.status})`);

  // Step 2: Graph API debug_token (unless --no-verify)
  if (args.verify) {
    console.log('[store-ig-token] verifying token via Graph API debug_token...');
    let dbg: DebugTokenResponse;
    try {
      dbg = await debugToken(args.token);
    } catch (err) {
      console.error(`[store-ig-token] debug_token call failed: ${(err as Error).message}`);
      console.error('  Pass --no-verify to skip and store anyway.');
      process.exit(4);
    }
    const d = dbg.data ?? {};
    console.log(`  is_valid: ${d.is_valid}`);
    console.log(`  type: ${d.type}`);
    console.log(`  expires_at: ${fmtUnixDate(d.expires_at)} (${daysFromNow(d.expires_at)} days from now)`);
    console.log(`  data_access_expires_at: ${fmtUnixDate(d.data_access_expires_at)}`);
    console.log(`  scopes: ${(d.scopes ?? []).join(', ') || 'none'}`);
    if (d.error?.message) console.log(`  error: ${d.error.message}`);

    if (d.is_valid !== true) {
      console.error('[store-ig-token] REJECTED — token is not valid. Re-do the OAuth dance.');
      process.exit(5);
    }
    if (daysFromNow(d.expires_at) < 50) {
      console.error(
        `[store-ig-token] REJECTED — token expires in ${daysFromNow(d.expires_at)} days. ` +
          `Need ≥50 days for D-011. Re-do OAuth and request a long-lived token.`
      );
      process.exit(6);
    }
    console.log('  ✓ token verified — valid AND long-lived');
  } else {
    console.log('[store-ig-token] skipping Graph API verification (--no-verify)');
  }

  // Step 3: encrypt
  const ciphertext = encrypt(args.token);
  console.log(`[store-ig-token] encrypted (${ciphertext.length} chars base64)`);

  // Step 4: UPDATE brand_configs
  const updateRow: Record<string, unknown> = { ig_token_encrypted: ciphertext };
  if (args.igAccount) updateRow['ig_business_account_id'] = args.igAccount;
  if (args.fbPage) updateRow['fb_page_id'] = args.fbPage;
  const { error: updErr } = await client.from('brand_configs').update(updateRow).eq('brand_id', brand.id);
  if (updErr) {
    console.error(`[store-ig-token] brand_configs update failed: ${updErr.message}`);
    process.exit(7);
  }
  console.log(`  ✓ brand_configs.ig_token_encrypted updated for brand_id=${brand.id}`);

  // Step 5: instructions for the human commit log
  const today = new Date().toISOString().substring(0, 10);
  console.log('\n[store-ig-token] DONE.');
  console.log('Next: append this row to CREDENTIALS.md "Rotation log" and commit:');
  console.log(`  | ${today} | Hashtag IG Page token | rotated to fresh 60-day | D-011 atomic session |`);
  console.log('Then add to SESSION_LOG.md current session entry: "IG token rotated for `' + args.slug + '` (D-011 complete)"');
}

main().catch((err: unknown) => {
  console.error('[store-ig-token] FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
