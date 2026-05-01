/**
 * post_queue + post_results queries.
 *
 * Idempotency contract (per migration 0001 unique constraint):
 *   - (brand_id, idempotency_key) is unique. Re-enqueueing with the same key returns
 *     the existing row instead of creating a duplicate. Upstream callers (n8n cron,
 *     manual triggers) should set a stable key per logical post.
 */

import { getAdminClient } from '../lib/supabase.js';
import type {
  PostQueueRow,
  PostQueueInsert,
  PostStatus,
  PostResultRow,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// post_queue
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert a post if (brand_id, idempotency_key) is new; otherwise return the existing row.
 * The unique constraint means we never create duplicates from upstream retries.
 */
export async function enqueuePost(input: PostQueueInsert): Promise<{ row: PostQueueRow; created: boolean }> {
  const client = getAdminClient();

  // Try insert first; on conflict, fall back to select.
  const { data, error } = await client
    .from('post_queue')
    .insert(input)
    .select('*')
    .single();

  if (!error) {
    return { row: data as PostQueueRow, created: true };
  }

  // 23505 = unique_violation
  if (error.code === '23505') {
    const { data: existing, error: selErr } = await client
      .from('post_queue')
      .select('*')
      .eq('brand_id', input.brand_id)
      .eq('idempotency_key', input.idempotency_key)
      .single();
    if (selErr) {
      throw new Error(`enqueuePost: insert hit conflict but select failed: ${selErr.message}`);
    }
    return { row: existing as PostQueueRow, created: false };
  }

  throw new Error(`enqueuePost(${input.brand_id}, ${input.idempotency_key}): ${error.message}`);
}

/** Update status (and optional reason). Used at every pipeline transition. */
export async function updatePostStatus(
  postId: string,
  status: PostStatus,
  options: { reason?: string | null; payloadPatch?: Record<string, unknown> } = {}
): Promise<PostQueueRow> {
  const update: Record<string, unknown> = { status };
  if (options.reason !== undefined) update.status_reason = options.reason;

  const client = getAdminClient();
  // If we have a payload patch, fold it into the existing payload via jsonb concatenation.
  if (options.payloadPatch) {
    // Read-modify-write — fine for MVP volume. If contention surfaces we'll move to a
    // postgres function with `jsonb_set`. Day-9 reliability hardening can revisit.
    const { data: current, error: selErr } = await client
      .from('post_queue').select('payload').eq('id', postId).single();
    if (selErr) throw new Error(`updatePostStatus(${postId}) read: ${selErr.message}`);
    update.payload = { ...((current?.payload as Record<string, unknown>) ?? {}), ...options.payloadPatch };
  }

  const { data, error } = await client
    .from('post_queue')
    .update(update)
    .eq('id', postId)
    .select('*')
    .single();
  if (error) throw new Error(`updatePostStatus(${postId} → ${status}): ${error.message}`);
  return data as PostQueueRow;
}

/** Mark a post as failed with the error captured for forensics. */
export async function markFailed(postId: string, errorMessage: string): Promise<PostQueueRow> {
  const { data, error } = await getAdminClient()
    .from('post_queue')
    .update({
      status: 'failed' as PostStatus,
      last_error: errorMessage,
      last_error_at: new Date().toISOString(),
    })
    .eq('id', postId)
    .select('*')
    .single();
  if (error) throw new Error(`markFailed(${postId}): ${error.message}`);
  return data as PostQueueRow;
}

/** Posts in `ready` status, ordered by oldest first. Used by Publisher A6 polling. */
export async function listReadyPosts(brandId?: string, limit = 50): Promise<PostQueueRow[]> {
  let q = getAdminClient()
    .from('post_queue')
    .select('*')
    .eq('status', 'ready' as PostStatus)
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (brandId) q = q.eq('brand_id', brandId);
  const { data, error } = await q;
  if (error) throw new Error(`listReadyPosts: ${error.message}`);
  return (data as PostQueueRow[]) ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// post_results
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record a successful publish. Updates post_queue.status → 'published' and
 * post_queue.published_at, then inserts post_results.
 */
export async function recordPublishSuccess(
  postId: string,
  brandId: string,
  igMediaId: string,
  igPermalink: string | null
): Promise<PostResultRow> {
  const client = getAdminClient();
  const now = new Date().toISOString();

  const { error: pqErr } = await client
    .from('post_queue')
    .update({ status: 'published' as PostStatus, published_at: now })
    .eq('id', postId);
  if (pqErr) throw new Error(`recordPublishSuccess pq update: ${pqErr.message}`);

  const { data, error } = await client
    .from('post_results')
    .insert({
      post_queue_id: postId,
      brand_id: brandId,
      ig_media_id: igMediaId,
      ig_permalink: igPermalink,
      published_at: now,
    })
    .select('*')
    .single();
  if (error) throw new Error(`recordPublishSuccess pr insert: ${error.message}`);
  return data as PostResultRow;
}
