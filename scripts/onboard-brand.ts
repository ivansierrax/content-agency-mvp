#!/usr/bin/env tsx
/**
 * Onboard a new brand into the MVP.
 *
 * Usage:
 *   npm run onboard -- --slug=<slug> --name="Brand Name" --client-filter="<NotionClient>" [--ig-account=<id>] [--ig-username=<u>] [--fb-page=<id>]
 *
 * What it does (in order):
 *   1. Pre-flight: query each of the 8 Hashtag-agency Notion DBs to confirm the
 *      `Client` select option named `<NotionClient>` already exists. Notion's
 *      data_sources API rejects unknown option values with HTTP 400 (see Day 7
 *      isolation test) — better to catch this BEFORE inserting Postgres rows.
 *   2. Idempotent insert into `brands` (slug as the unique key).
 *   3. Idempotent insert into `brand_configs` with `notion_client_filter` set.
 *   4. Trigger first sync via `POST /admin/refresh-brand/<slug>` against the
 *      configured service URL (Railway production by default; override via
 *      `MVP_SERVICE_URL`).
 *   5. Report counts + warnings.
 *
 * Inputs you must collect manually BEFORE running this:
 *   - The Notion `Client` select option. Open EACH of the 8 agency DBs (Pillars,
 *     Recipes, Photo Config, CTA Bank, Hook Bank, Lexicon, Brand Themes, Image
 *     Strategy) and add `<BrandName>` to the `Client` select property. The CLI
 *     pre-flight will tell you which DB(s) are missing the option.
 *   - At least 1 active row per category for the new brand, otherwise downstream
 *     pipeline will improvise (Sonnet picks names not linked to Notion IDs).
 *
 * The CLI is idempotent — safe to re-run after fixing missing options.
 */

import process from 'node:process';
import { loadEnv } from '../src/lib/env.js';
import { NOTION_DATA_SOURCES } from '../src/sync/notion-brand.js';
import { getAdminClient } from '../src/lib/supabase.js';

interface CliArgs {
  slug: string;
  name: string;
  clientFilter: string;
  igAccount?: string;
  igUsername?: string;
  fbPage?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string> = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([a-zA-Z0-9-]+)=(.*)$/);
    if (m) args[m[1]!] = m[2]!;
  }
  const required = ['slug', 'name', 'client-filter'];
  for (const k of required) {
    if (!args[k]) {
      console.error(`Missing required arg: --${k}`);
      console.error('Usage: npm run onboard -- --slug=<slug> --name="<name>" --client-filter="<NotionClient>" [--ig-account=<id>] [--ig-username=<u>] [--fb-page=<id>]');
      process.exit(2);
    }
  }
  return {
    slug: args['slug']!,
    name: args['name']!,
    clientFilter: args['client-filter']!,
    igAccount: args['ig-account'],
    igUsername: args['ig-username'],
    fbPage: args['fb-page'],
  };
}

interface PreflightResult {
  category: string;
  ds_id: string;
  ok: boolean;
  reason?: string;
  options_seen?: string[];
}

async function preflightDataSource(
  category: string,
  dsId: string,
  clientFilter: string,
  apiKey: string,
  notionVersion: string
): Promise<PreflightResult> {
  // Issue a query with the proposed filter — if Notion rejects with
  // "select option not found", we get a clean error with the available options.
  const res = await fetch(`https://api.notion.com/v1/data_sources/${dsId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': notionVersion,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filter: {
        and: [
          { property: 'Active', checkbox: { equals: true } },
          { property: 'Client', select: { equals: clientFilter } },
        ],
      },
      page_size: 1,
    }),
  });
  if (res.ok) {
    return { category, ds_id: dsId, ok: true };
  }
  const text = await res.text().catch(() => '');
  // Parse the helpful "Available options: \"Hashtag\", \"OtherBrand\"." hint.
  // Notion's payload has escaped JSON-strings — match all quoted substrings
  // after "Available options:" up to the first period.
  const optsRegion = text.match(/Available options:\s*([^.]+)/)?.[1] ?? '';
  const optionsSeen = [...optsRegion.matchAll(/\\?"([^"\\]+)\\?"/g)]
    .map((m) => m[1] ?? '')
    .filter(Boolean);
  return {
    category,
    ds_id: dsId,
    ok: false,
    reason: `HTTP ${res.status}: ${text.substring(0, 200)}`,
    options_seen: optionsSeen,
  };
}

async function preflightAll(
  clientFilter: string,
  apiKey: string,
  notionVersion: string
): Promise<PreflightResult[]> {
  return Promise.all(
    Object.entries(NOTION_DATA_SOURCES).map(([category, dsId]) =>
      preflightDataSource(category, dsId, clientFilter, apiKey, notionVersion)
    )
  );
}

async function upsertBrand(args: CliArgs): Promise<{ id: string; created: boolean }> {
  const client = getAdminClient();
  // Try insert; on slug collision, return existing.
  const { data, error } = await client
    .from('brands')
    .insert({ slug: args.slug, name: args.name, status: 'onboarding' })
    .select('id')
    .single();
  if (!error) return { id: (data as { id: string }).id, created: true };
  if (error.code === '23505') {
    const { data: existing, error: selErr } = await client
      .from('brands')
      .select('id')
      .eq('slug', args.slug)
      .single();
    if (selErr) throw new Error(`upsertBrand select-after-conflict: ${selErr.message}`);
    return { id: (existing as { id: string }).id, created: false };
  }
  throw new Error(`upsertBrand: ${error.message}`);
}

async function upsertBrandConfig(args: CliArgs, brandId: string): Promise<{ created: boolean }> {
  const client = getAdminClient();
  const insertRow = {
    brand_id: brandId,
    notion_client_filter: args.clientFilter,
    ...(args.igAccount && { ig_business_account_id: args.igAccount }),
    ...(args.igUsername && { ig_username: args.igUsername }),
    ...(args.fbPage && { fb_page_id: args.fbPage }),
    brand_identity: {},
  };
  const { error } = await client.from('brand_configs').insert(insertRow);
  if (!error) return { created: true };
  if (error.code === '23505') {
    // Already exists — UPDATE the filter + IG fields (don't blow away brand_identity).
    const updateRow: Record<string, unknown> = { notion_client_filter: args.clientFilter };
    if (args.igAccount) updateRow['ig_business_account_id'] = args.igAccount;
    if (args.igUsername) updateRow['ig_username'] = args.igUsername;
    if (args.fbPage) updateRow['fb_page_id'] = args.fbPage;
    const { error: updErr } = await client.from('brand_configs').update(updateRow).eq('brand_id', brandId);
    if (updErr) throw new Error(`upsertBrandConfig update: ${updErr.message}`);
    return { created: false };
  }
  throw new Error(`upsertBrandConfig: ${error.message}`);
}

async function triggerFirstSync(slug: string, serviceUrl: string): Promise<unknown> {
  const res = await fetch(`${serviceUrl.replace(/\/+$/, '')}/admin/refresh-brand/${slug}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(60_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`first sync HTTP ${res.status}: ${JSON.stringify(json).substring(0, 300)}`);
  }
  return json;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const env = loadEnv();
  const serviceUrl = process.env['MVP_SERVICE_URL'] ?? 'https://content-agency-mvp-production.up.railway.app';

  console.log(`[onboard] starting: slug=${args.slug} name="${args.name}" client_filter="${args.clientFilter}"`);
  console.log(`[onboard] service_url=${serviceUrl}\n`);

  // Step 1: pre-flight Notion select-option check
  console.log('[onboard] step 1/4: pre-flight Notion select-option check across 8 DBs...');
  const preflight = await preflightAll(args.clientFilter, env.NOTION_API_KEY, env.NOTION_VERSION);
  const failures = preflight.filter((p) => !p.ok);
  if (failures.length > 0) {
    console.error('\n[onboard] PREFLIGHT FAILED — Notion `Client` select option missing in:');
    for (const f of failures) {
      console.error(`  - ${f.category} (ds=${f.ds_id})`);
      if (f.options_seen?.length) console.error(`      available options: ${f.options_seen.join(', ')}`);
    }
    console.error(`\nFix: open EACH failing DB in Notion → Properties → "Client" select → Add option "${args.clientFilter}"`);
    console.error('Then re-run this CLI. The other steps are idempotent.');
    process.exit(3);
  }
  console.log(`  ✓ all 8 DBs accept Client="${args.clientFilter}"\n`);

  // Step 2: upsert brand
  console.log('[onboard] step 2/4: upsert brands row...');
  const brand = await upsertBrand(args);
  console.log(`  ${brand.created ? '✓ created' : '↻ existed'} brand_id=${brand.id}\n`);

  // Step 3: upsert brand_config
  console.log('[onboard] step 3/4: upsert brand_configs row...');
  const config = await upsertBrandConfig(args, brand.id);
  console.log(`  ${config.created ? '✓ created' : '↻ updated'} notion_client_filter="${args.clientFilter}"\n`);

  // Step 4: first sync
  console.log('[onboard] step 4/4: trigger first Notion sync...');
  const syncResult = (await triggerFirstSync(args.slug, serviceUrl)) as {
    counts?: Record<string, number>;
    warnings?: string[];
    elapsed_ms?: number;
  };
  console.log(`  ✓ sync ran in ${syncResult.elapsed_ms ?? '?'}ms`);
  console.log(`  counts: ${JSON.stringify(syncResult.counts)}`);
  if (syncResult.warnings?.length) {
    console.warn(`  ⚠ warnings:`);
    for (const w of syncResult.warnings) console.warn(`    - ${w}`);
  } else {
    console.log(`  warnings: none`);
  }
  console.log('\n[onboard] DONE.');
  console.log(`Next steps:`);
  console.log(`  1. Set IG token via: npm run store-ig-token -- --slug=${args.slug} --token=<plaintext_token>`);
  console.log(`  2. Mark brand active: UPDATE brands SET status='active' WHERE id='${brand.id}';`);
  console.log(`  3. Smoke test: POST /run-pipeline with brand_slug=${args.slug}`);
}

main().catch((err: unknown) => {
  console.error('[onboard] FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
