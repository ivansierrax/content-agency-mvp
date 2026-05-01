/**
 * Supabase client wrapper.
 *
 * Two clients:
 *   - admin   — uses SUPABASE_SECRET_KEY, bypasses RLS. Used by the Node service for all writes.
 *   - public  — uses SUPABASE_PUBLISHABLE_KEY, respects RLS. Reserved for future anon-key surfaces.
 *
 * Both are lazy singletons — first call constructs, subsequent calls reuse.
 *
 * Note (D-002): we intentionally use supabase-js for convenience. If we need raw SQL
 * (transactions, CTEs, advisory locks), reach for a `pg` connection — but for MVP CRUD
 * everything fits the supabase-js shape.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from './env.js';

let adminClient: SupabaseClient | null = null;
let publicClient: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;
  const env = loadEnv();
  adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' },
  });
  return adminClient;
}

export function getPublicClient(): SupabaseClient {
  if (publicClient) return publicClient;
  const env = loadEnv();
  publicClient = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' },
  });
  return publicClient;
}

/**
 * Run a quick connectivity check. Returns latency in ms or throws on failure.
 * Used by /health to surface DB connectivity status without leaking row counts.
 */
export async function checkDbHealth(): Promise<{ ok: true; latencyMs: number }> {
  const start = Date.now();
  const { error } = await getAdminClient()
    .from('brands')
    .select('id', { count: 'exact', head: true });
  if (error) {
    throw new Error(`db health check failed: ${error.message}`);
  }
  return { ok: true, latencyMs: Date.now() - start };
}
