/**
 * TypeScript shapes for the Postgres schema in supabase/migrations/0001_init.sql + 0002_brand_identity_jsonb.sql.
 *
 * Hand-rolled for MVP. Day 9+: replace with `supabase gen types typescript` output.
 *
 * Two-shape pattern per table:
 *   - Row     — full row as it comes back from select (all columns, including DB defaults)
 *   - Insert  — what the app passes to insert (DB-defaulted columns optional)
 *   - Update  — partial row for update (everything optional except identity)
 */

// ─────────────────────────────────────────────────────────────────────────────
// brands
// ─────────────────────────────────────────────────────────────────────────────
export type BrandStatus = 'onboarding' | 'active' | 'paused' | 'churned';

export interface BrandRow {
  id: string;
  slug: string;
  name: string;
  status: BrandStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface BrandInsert {
  slug: string;
  name: string;
  status?: BrandStatus;
  notes?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// brand_configs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shape of `brand_identity` jsonb (D-009). Mirrors the 9 Notion DBs.
 * Each field is an array of "active" rows from the matching DB filtered to this brand's `Client` value.
 * Fields are optional — a brand may not have rows in every DB.
 *
 * Day 5 sync writes this; the pipeline reads it. Humans never edit it directly.
 */
export interface BrandIdentity {
  themes?: unknown[];        // Brand Themes — colors, fonts, logo, footer, tagline
  pillars?: unknown[];       // Pillars — name, code, CTA, voice notes, forbidden angles
  image_rules?: unknown[];   // Image Strategy Rules — photo-routing logic
  blueprints?: unknown[];    // Blueprints — versioned editorial blueprint pointers
  recipes?: unknown[];       // Content Recipes
  ctas?: unknown[];          // CTA Bank
  hooks?: unknown[];         // Hook Bank
  lexicon?: unknown[];       // Lexicon
  photo?: unknown;           // Photo Config
  // Free-form passthrough — anything Notion adds in the future shows up here
  // without code changes. Pipeline reads what it knows; ignores unknowns.
  [key: string]: unknown;
}

export type PublishAccountLabel = 'main' | 'secondary';
export type BrandIdentitySource = 'notion' | 'manual';

export interface BrandConfigRow {
  brand_id: string;
  ig_business_account_id: string | null;
  ig_username: string | null;
  fb_page_id: string | null;
  ig_token_encrypted: string | null;
  notion_token_encrypted: string | null;
  ga_token_encrypted: string | null;
  notion_brand_db_id: string | null;
  notion_strategy_page_id: string | null;
  publish_account_label: PublishAccountLabel;
  posts_per_week: number;
  posts_per_day_max: number;
  client_approval_required: boolean;
  brand_identity: BrandIdentity;
  brand_identity_synced_at: string | null;
  brand_identity_source: BrandIdentitySource;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface BrandConfigInsert {
  brand_id: string;
  ig_business_account_id?: string | null;
  ig_username?: string | null;
  fb_page_id?: string | null;
  ig_token_encrypted?: string | null;
  notion_token_encrypted?: string | null;
  ga_token_encrypted?: string | null;
  notion_brand_db_id?: string | null;
  notion_strategy_page_id?: string | null;
  publish_account_label?: PublishAccountLabel;
  posts_per_week?: number;
  posts_per_day_max?: number;
  client_approval_required?: boolean;
  brand_identity?: BrandIdentity;
  brand_identity_source?: BrandIdentitySource;
}

// ─────────────────────────────────────────────────────────────────────────────
// post_queue
// ─────────────────────────────────────────────────────────────────────────────
export type PostStatus =
  | 'pending'
  | 'strategist'
  | 'writer'
  | 'editor'
  | 'spanish_editor'
  | 'qg'
  | 'designer'
  | 'ready'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'rejected'
  | 'archived';

export interface PostQueueRow {
  id: string;
  brand_id: string;
  idempotency_key: string;
  status: PostStatus;
  status_reason: string | null;
  payload: Record<string, unknown>;
  scheduled_for: string | null;
  published_at: string | null;
  attempt_count: number;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface PostQueueInsert {
  brand_id: string;
  idempotency_key: string;
  status?: PostStatus;
  payload?: Record<string, unknown>;
  scheduled_for?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// post_results
// ─────────────────────────────────────────────────────────────────────────────
export interface PostResultRow {
  id: string;
  post_queue_id: string;
  brand_id: string;
  ig_media_id: string | null;
  ig_permalink: string | null;
  published_at: string | null;
  publish_error: string | null;
  publish_attempt_count: number;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// analytics_snapshots
// ─────────────────────────────────────────────────────────────────────────────
export interface AnalyticsSnapshotRow {
  id: string;
  post_result_id: string;
  brand_id: string;
  snapshot_at: string;
  reach: number | null;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  profile_visits: number | null;
  follows: number | null;
  raw: Record<string, unknown> | null;
  created_at: string;
}
