/**
 * Brand + brand_config queries.
 *
 * Convention: every function takes the brand by `slug` (human-readable) at the
 * boundary, then resolves to `id` (uuid) internally. This keeps call sites readable
 * and prevents accidental id-leakage in logs.
 *
 * All functions throw on db error. Callers should wrap in try/catch + Sentry.
 */

import { getAdminClient } from '../lib/supabase.js';
import { decryptNullable } from '../lib/crypto.js';
import type {
  BrandRow,
  BrandInsert,
  BrandConfigRow,
  BrandConfigInsert,
  BrandIdentity,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

/** Lookup a brand by slug. Returns null if not found or archived. */
export async function getBrandBySlug(slug: string): Promise<BrandRow | null> {
  const { data, error } = await getAdminClient()
    .from('brands')
    .select('*')
    .eq('slug', slug)
    .is('archived_at', null)
    .maybeSingle();
  if (error) throw new Error(`getBrandBySlug(${slug}): ${error.message}`);
  return (data as BrandRow | null) ?? null;
}

/** Lookup a brand by id. Returns null if not found or archived. */
export async function getBrandById(id: string): Promise<BrandRow | null> {
  const { data, error } = await getAdminClient()
    .from('brands')
    .select('*')
    .eq('id', id)
    .is('archived_at', null)
    .maybeSingle();
  if (error) throw new Error(`getBrandById(${id}): ${error.message}`);
  return (data as BrandRow | null) ?? null;
}

/** All non-archived brands, ordered by slug. */
export async function listBrands(): Promise<BrandRow[]> {
  const { data, error } = await getAdminClient()
    .from('brands')
    .select('*')
    .is('archived_at', null)
    .order('slug', { ascending: true });
  if (error) throw new Error(`listBrands: ${error.message}`);
  return (data as BrandRow[]) ?? [];
}

/** Brands currently in 'active' status (eligible for the daily content cycle). */
export async function listActiveBrands(): Promise<BrandRow[]> {
  const { data, error } = await getAdminClient()
    .from('brands')
    .select('*')
    .eq('status', 'active')
    .is('archived_at', null)
    .order('slug', { ascending: true });
  if (error) throw new Error(`listActiveBrands: ${error.message}`);
  return (data as BrandRow[]) ?? [];
}

/**
 * Brand config for a brand, keyed by slug. Encrypted token columns are NOT decrypted
 * here — call `getBrandConfigDecrypted` if you need the plaintext (and only do so
 * at the moment of use, never to log).
 */
export async function getBrandConfig(slug: string): Promise<BrandConfigRow | null> {
  const brand = await getBrandBySlug(slug);
  if (!brand) return null;
  const { data, error } = await getAdminClient()
    .from('brand_configs')
    .select('*')
    .eq('brand_id', brand.id)
    .maybeSingle();
  if (error) throw new Error(`getBrandConfig(${slug}): ${error.message}`);
  return (data as BrandConfigRow | null) ?? null;
}

export interface BrandConfigDecrypted extends Omit<BrandConfigRow,
  'ig_token_encrypted' | 'notion_token_encrypted' | 'ga_token_encrypted'> {
  ig_token: string | null;
  notion_token: string | null;
  ga_token: string | null;
}

/**
 * Brand config with secrets decrypted. Use only at point-of-use (e.g. right before
 * an IG API call). Never log the result. Never persist.
 */
export async function getBrandConfigDecrypted(slug: string): Promise<BrandConfigDecrypted | null> {
  const config = await getBrandConfig(slug);
  if (!config) return null;
  const { ig_token_encrypted, notion_token_encrypted, ga_token_encrypted, ...rest } = config;
  return {
    ...rest,
    ig_token: decryptNullable(ig_token_encrypted),
    notion_token: decryptNullable(notion_token_encrypted),
    ga_token: decryptNullable(ga_token_encrypted),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

/** Insert a brand. Returns the inserted row. Throws on slug collision. */
export async function insertBrand(brand: BrandInsert): Promise<BrandRow> {
  const { data, error } = await getAdminClient()
    .from('brands')
    .insert(brand)
    .select('*')
    .single();
  if (error) throw new Error(`insertBrand(${brand.slug}): ${error.message}`);
  return data as BrandRow;
}

/** Insert a brand_config. Caller is responsible for encrypting tokens before passing them. */
export async function insertBrandConfig(config: BrandConfigInsert): Promise<BrandConfigRow> {
  const { data, error } = await getAdminClient()
    .from('brand_configs')
    .insert(config)
    .select('*')
    .single();
  if (error) throw new Error(`insertBrandConfig(${config.brand_id}): ${error.message}`);
  return data as BrandConfigRow;
}

/**
 * Atomic-ish upsert for brand_identity (D-010 sync).
 * Sets brand_identity + brand_identity_synced_at = now().
 */
export async function upsertBrandIdentity(brandId: string, identity: BrandIdentity): Promise<void> {
  const { error } = await getAdminClient()
    .from('brand_configs')
    .update({
      brand_identity: identity,
      brand_identity_synced_at: new Date().toISOString(),
    })
    .eq('brand_id', brandId);
  if (error) throw new Error(`upsertBrandIdentity(${brandId}): ${error.message}`);
}
