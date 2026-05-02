/**
 * Notion brand-identity sync (Day 5, D-010).
 *
 * Reads the 8 shared Hashtag-agency Notion data sources, filtered to ONE brand's
 * `Client` select option, and upserts the union into `brand_configs.brand_identity`
 * jsonb. Pipeline reads from Postgres only — Notion is the edit surface, Postgres
 * is the cache.
 *
 * Architecture decisions baked in:
 *   - Data source IDs are constants. The shared Hashtag agency DBs are common to
 *     all clients; per-brand isolation is by `Client` select filter only. Future
 *     agencies forking this codebase swap the constants.
 *   - Single Notion API token via env (MVP). Day 9 cleanup migrates to a scoped
 *     read-only integration. Day 7 onboarding-CLI per-brand path will use
 *     `brand_configs.notion_token_encrypted` if a brand has its own token.
 *   - Property mapping mirrors n8n Strategist's "Load Scouted + Creative Config"
 *     node verbatim. Any future Notion DB column rename surfaces here.
 *   - Sync writes the FULL union; partial syncs are not supported. If Notion is
 *     up but ONE DB returns 0 rows, that category is empty for the brand. The
 *     pipeline's defensive "(none — pick yourself)" prompt language handles this.
 */

import * as Sentry from '@sentry/node';
import { loadEnv } from '../lib/env.js';
import type { BrandIdentity } from '../db/types.js';
import { upsertBrandIdentity } from '../db/brands.js';
import { getAdminClient } from '../lib/supabase.js';

// ─────────────────────────────────────────────────────────────────────────────
// Data source IDs (Notion 2025-09-03 API, shared across Hashtag agency clients)
// ─────────────────────────────────────────────────────────────────────────────

export const NOTION_DATA_SOURCES = {
  pillars: 'fbc5dbe2-fc00-4a92-b2d4-9bb8df3e7a2a',
  recipes: '3b052f29-62b8-4bd2-9ccb-85a15e527d70',
  photo_config: 'd9b85828-ebe7-429d-80a1-53466aa3daad',
  cta_bank: '70239eb6-6cb2-4be5-8dba-527bff75cadf',
  hook_bank: 'ab01f687-89b3-487c-bfe4-f3eb6aff64d9',
  lexicon: '61b81bbb-1377-4221-a6f0-78667f3f51da',
  brand_themes: 'c5621d6e-36b5-4cb7-ac00-087342ec817c',
  image_strategy: 'fa063e14-624e-423f-b5a1-197b1e79b3e5',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Notion property readers (verbatim from n8n Strategist Load node)
// ─────────────────────────────────────────────────────────────────────────────

interface NotionPage {
  id: string;
  properties: Record<string, NotionProperty>;
}

type NotionProperty =
  | { title?: NotionTextRun[] }
  | { rich_text?: NotionTextRun[] }
  | { select?: { name?: string } | null }
  | { multi_select?: Array<{ name: string }> }
  | { checkbox?: boolean }
  | { url?: string | null }
  | { number?: number | null }
  | { date?: { start?: string | null } | null };

interface NotionTextRun {
  plain_text?: string;
  text?: { content?: string };
}

function readTextRuns(runs: NotionTextRun[] | undefined): string {
  if (!Array.isArray(runs)) return '';
  return runs.map((r) => r.plain_text ?? r.text?.content ?? '').join('');
}

function title(page: NotionPage, name: string): string {
  const prop = page.properties[name] as { title?: NotionTextRun[] } | undefined;
  return readTextRuns(prop?.title);
}

function rich(page: NotionPage, name: string): string {
  const prop = page.properties[name] as { rich_text?: NotionTextRun[] } | undefined;
  return readTextRuns(prop?.rich_text);
}

function sel(page: NotionPage, name: string): string {
  const prop = page.properties[name] as { select?: { name?: string } | null } | undefined;
  return prop?.select?.name ?? '';
}

function multi(page: NotionPage, name: string): string[] {
  const prop = page.properties[name] as { multi_select?: Array<{ name: string }> } | undefined;
  return (prop?.multi_select ?? []).map((o) => o.name);
}

function chk(page: NotionPage, name: string): boolean {
  const prop = page.properties[name] as { checkbox?: boolean } | undefined;
  return prop?.checkbox === true;
}

function num(page: NotionPage, name: string): number | null {
  const prop = page.properties[name] as { number?: number | null } | undefined;
  return prop?.number ?? null;
}

function dateStart(page: NotionPage, name: string): string | null {
  const prop = page.properties[name] as { date?: { start?: string | null } | null } | undefined;
  return prop?.date?.start ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Notion data_sources query
// ─────────────────────────────────────────────────────────────────────────────

interface QueryResult {
  results: NotionPage[];
}

async function queryDataSource(
  dsId: string,
  clientFilter: string,
  apiKey: string,
  notionVersion: string
): Promise<QueryResult> {
  const body = {
    filter: {
      and: [
        { property: 'Active', checkbox: { equals: true } },
        { property: 'Client', select: { equals: clientFilter } },
      ],
    },
    page_size: 100,
  };
  const res = await fetch(`https://api.notion.com/v1/data_sources/${dsId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': notionVersion,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`notion_query ${dsId}: HTTP ${res.status} ${text.substring(0, 300)}`);
  }
  return (await res.json()) as QueryResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mappers — Notion page → brand_identity row shape
// ─────────────────────────────────────────────────────────────────────────────

function mapPillar(p: NotionPage) {
  return {
    id: p.id,
    name: title(p, 'Name'),
    short_code: rich(p, 'Short Code'),
    description: rich(p, 'Description'),
    cta_text_default: rich(p, 'CTA Text'),
    voice_notes: rich(p, 'Voice Notes'),
    forbidden_angles: rich(p, 'Forbidden Angles'),
    preferred_recipes: multi(p, 'Preferred Recipes'),
    hashtag_seed_pool: rich(p, 'Hashtag Seed Pool'),
  };
}

function mapRecipe(p: NotionPage) {
  return {
    id: p.id,
    name: title(p, 'Name'),
    format: sel(p, 'Format'),
    theme_code: rich(p, 'Theme Code'),
    slide_sequence_json: rich(p, 'Slide Sequence JSON'),
    trigger_match: multi(p, 'Trigger Match'),
    data_card_eligibility: sel(p, 'Data Card Eligibility'),
    min_metrics: num(p, 'Min Metrics') ?? 0,
    min_brands: num(p, 'Min Brands') ?? 0,
    requires_quote: chk(p, 'Requires Quote'),
    notes: rich(p, 'Notes'),
  };
}

function mapPhotoConfig(p: NotionPage) {
  return {
    id: p.id,
    name: title(p, 'Name'),
    style_anchor: rich(p, 'Style Anchor'),
    camera_anchor: rich(p, 'Camera Anchor'),
    mood_baseline: rich(p, 'Mood Baseline'),
    composition_default: rich(p, 'Composition Default'),
    person_age_range: rich(p, 'Person Age Range'),
    person_ethnicity_pool: rich(p, 'Person Ethnicity Pool'),
    person_gender_rule: rich(p, 'Person Gender Rule'),
    person_wardrobe_mix: rich(p, 'Person Wardrobe Mix'),
    person_action_note: rich(p, 'Person Action Note'),
    person_banned_patterns: rich(p, 'Person Banned Patterns'),
    object_choice_rule: rich(p, 'Object Choice Rule'),
    object_surface_pool: rich(p, 'Object Surface Pool'),
    object_surface_banned: rich(p, 'Object Surface Banned'),
    object_count_max: num(p, 'Object Count Max'),
    object_composition: rich(p, 'Object Composition'),
    object_lighting: rich(p, 'Object Lighting'),
    scene_settings_pool: rich(p, 'Scene Settings Pool'),
    scene_time_of_day_pool: rich(p, 'Scene Time of Day Pool'),
    scene_palette_pool: rich(p, 'Scene Palette Pool'),
    negative_prompt_bank: rich(p, 'Negative Prompt Bank'),
    single_image_bg_rotation: rich(p, 'Single Image BG Rotation'),
    voice_tone_tags: rich(p, 'Voice Tone Tags'),
  };
}

function mapCta(p: NotionPage) {
  return {
    id: p.id,
    name: title(p, 'Name'),
    pillar: sel(p, 'Pillar'),
    role: sel(p, 'Role'),
    text: rich(p, 'Text'),
    last_used: dateStart(p, 'Last Used'),
  };
}

function mapHook(p: NotionPage) {
  return {
    id: p.id,
    name: title(p, 'Name'),
    trigger: sel(p, 'Trigger'),
    template: rich(p, 'Template'),
    last_used: dateStart(p, 'Last Used'),
  };
}

function mapLexicon(p: NotionPage) {
  return {
    name: title(p, 'Name'),
    type: sel(p, 'Type'),
    english: rich(p, 'English'),
    spanish: rich(p, 'Spanish'),
    notes: rich(p, 'Notes'),
  };
}

function mapBrandTheme(p: NotionPage) {
  return {
    id: p.id,
    name: title(p, 'Name'),
    primary_color: rich(p, 'Primary Color'),
    accent_color: rich(p, 'Accent Color'),
    bg_dark: rich(p, 'Background Color Dark'),
    bg_light: rich(p, 'Background Color Light'),
    body_text_color: rich(p, 'Body Text Color'),
    muted_text_color: rich(p, 'Muted Text Color'),
    text_on_dark: rich(p, 'Text Color Dark Bg'),
    text_on_light: rich(p, 'Text Color Light Bg'),
    heading_font: rich(p, 'Heading Font'),
    body_font: rich(p, 'Body Font'),
    label_font: rich(p, 'Label Font'),
    footer_line: rich(p, 'Footer Line'),
    tagline: rich(p, 'Tagline'),
  };
}

function mapImageRule(p: NotionPage) {
  return { name: title(p, 'Name'), notes: rich(p, 'Notes') };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncBrandIdentityResult {
  brand_id: string;
  brand_slug: string;
  notion_client_filter: string;
  counts: {
    themes: number;
    pillars: number;
    recipes: number;
    ctas: number;
    hooks: number;
    lexicon: number;
    image_rules: number;
    photo: number; // 0 or 1
  };
  warnings: string[];
  synced_at: string;
}

/**
 * Pull all 8 DBs in parallel, map to brand_identity shape, upsert.
 * Throws on Notion API failure (caller decides whether to retry or alert).
 */
export async function syncBrandIdentity(params: {
  brand_id: string;
  brand_slug: string;
  notion_client_filter: string;
}): Promise<SyncBrandIdentityResult> {
  const env = loadEnv();
  const start = Date.now();

  const queries = await Promise.all([
    queryDataSource(NOTION_DATA_SOURCES.pillars, params.notion_client_filter, env.NOTION_API_KEY, env.NOTION_VERSION),
    queryDataSource(NOTION_DATA_SOURCES.recipes, params.notion_client_filter, env.NOTION_API_KEY, env.NOTION_VERSION),
    queryDataSource(NOTION_DATA_SOURCES.photo_config, params.notion_client_filter, env.NOTION_API_KEY, env.NOTION_VERSION),
    queryDataSource(NOTION_DATA_SOURCES.cta_bank, params.notion_client_filter, env.NOTION_API_KEY, env.NOTION_VERSION),
    queryDataSource(NOTION_DATA_SOURCES.hook_bank, params.notion_client_filter, env.NOTION_API_KEY, env.NOTION_VERSION),
    queryDataSource(NOTION_DATA_SOURCES.lexicon, params.notion_client_filter, env.NOTION_API_KEY, env.NOTION_VERSION),
    queryDataSource(NOTION_DATA_SOURCES.brand_themes, params.notion_client_filter, env.NOTION_API_KEY, env.NOTION_VERSION),
    queryDataSource(NOTION_DATA_SOURCES.image_strategy, params.notion_client_filter, env.NOTION_API_KEY, env.NOTION_VERSION),
  ]);
  const [pillars, recipes, photoConfig, ctaBank, hookBank, lexicon, brandThemes, imageStrategy] = queries;

  const identity: BrandIdentity = {
    pillars: pillars.results.map(mapPillar),
    recipes: recipes.results.map(mapRecipe),
    photo: photoConfig.results.length > 0 ? mapPhotoConfig(photoConfig.results[0]!) : undefined,
    ctas: ctaBank.results.map(mapCta),
    hooks: hookBank.results.map(mapHook),
    lexicon: lexicon.results.map(mapLexicon),
    themes: brandThemes.results.length > 0 ? [mapBrandTheme(brandThemes.results[0]!)] : [],
    image_rules: imageStrategy.results.map(mapImageRule),
  };

  await upsertBrandIdentity(params.brand_id, identity);

  const warnings: string[] = [];
  if (identity.pillars!.length === 0) warnings.push('Pillars: 0 active rows');
  if (identity.recipes!.length === 0) warnings.push('Recipes: 0 active rows');
  if (identity.ctas!.length === 0) warnings.push('CTA Bank: 0 active rows');
  if (identity.hooks!.length === 0) warnings.push('Hook Bank: 0 active rows');
  if (!identity.photo) warnings.push('Photo Config: missing');
  if (identity.themes!.length === 0) warnings.push('Brand Themes: missing');

  const result: SyncBrandIdentityResult = {
    brand_id: params.brand_id,
    brand_slug: params.brand_slug,
    notion_client_filter: params.notion_client_filter,
    counts: {
      themes: identity.themes!.length,
      pillars: identity.pillars!.length,
      recipes: identity.recipes!.length,
      ctas: identity.ctas!.length,
      hooks: identity.hooks!.length,
      lexicon: identity.lexicon!.length,
      image_rules: identity.image_rules!.length,
      photo: identity.photo ? 1 : 0,
    },
    warnings,
    synced_at: new Date().toISOString(),
  };

  Sentry.addBreadcrumb({
    category: 'notion_sync',
    level: warnings.length > 0 ? 'warning' : 'info',
    message: `notion_sync brand=${params.brand_slug} elapsed=${Date.now() - start}ms`,
    data: { ...result.counts, warnings_count: warnings.length },
  });

  return result;
}

/**
 * Sync every active/onboarding brand. Per-brand failures are isolated — one
 * brand's Notion outage does not block others.
 */
export async function syncAllBrands(): Promise<SyncBrandIdentityResult[]> {
  const client = getAdminClient();
  const { data, error } = await client
    .from('brands')
    .select('id, slug, status, brand_configs(notion_client_filter)')
    .in('status', ['active', 'onboarding'])
    .is('archived_at', null);
  if (error) throw new Error(`syncAllBrands: list brands: ${error.message}`);

  type Row = {
    id: string;
    slug: string;
    status: string;
    brand_configs: { notion_client_filter: string | null }[] | null;
  };
  const rows = (data as Row[]) ?? [];

  const results: SyncBrandIdentityResult[] = [];
  for (const row of rows) {
    const filter = row.brand_configs?.[0]?.notion_client_filter;
    if (!filter) {
      Sentry.addBreadcrumb({
        category: 'notion_sync',
        level: 'warning',
        message: `notion_sync skipped brand=${row.slug}: notion_client_filter is null`,
      });
      continue;
    }
    try {
      const result = await syncBrandIdentity({
        brand_id: row.id,
        brand_slug: row.slug,
        notion_client_filter: filter,
      });
      results.push(result);
    } catch (err) {
      Sentry.captureException(err, { tags: { source: 'syncAllBrands', brand_slug: row.slug } });
    }
  }
  return results;
}
