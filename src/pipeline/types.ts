/**
 * Pipeline envelope shape.
 *
 * One PostEnvelope flows through the chain (extract → strategy → write →
 * edit → spanish-edit → ground-check → qg → design → publish). Each step
 * reads its input slice and appends its output slice. Persisted at every
 * boundary to `post_queue.payload` for replayability + auditability.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Anchor claims (extracted from source) — the single source of truth for grounding
// per D-012. After extraction + verification, every downstream step trusts THIS
// shape, not the raw source text.
// ─────────────────────────────────────────────────────────────────────────────

export interface NumericClaim {
  /** Verbatim from source — e.g. "65,000", "13.0%", "$2.5B", "3x". */
  value: string;
  /** Short fragment showing where it appeared, for human triage. */
  context: string;
}

export interface DirectQuote {
  /** Verbatim quoted text. */
  quote: string;
  /** Speaker / source attribution, or "unattributed". */
  attributed_to: string;
}

export interface SourceMeta {
  author: string;
  publication: string;
  /** ISO date string, or empty. */
  date: string;
}

export interface AnchorClaims {
  numeric_claims: NumericClaim[];
  direct_quotes: DirectQuote[];
  /** Causal claims allow minimal paraphrase per spec — verifier can't substring-check these strictly. */
  causal_claims: string[];
  named_entities: string[];
  source_meta: SourceMeta;
}

export type AnchorWeightTier = 'data-rich' | 'narrative-strong' | 'narrative-thin' | 'opinion-only';

export interface AnchorWeight {
  numeric: number;
  quotes: number;
  causal: number;
  entities: number;
  total_citable: number;
  tier: AnchorWeightTier;
}

/** Result of extraction + post-extraction substring verification. */
export interface ExtractionResult {
  claims: AnchorClaims;
  anchor_weight: AnchorWeight;
  /** Claims dropped by the verifier — Sonnet emitted them but they don't appear in source. */
  dropped: Array<{
    category: 'numeric' | 'quote';
    value: string;
    context: string;
    reason: string;
  }>;
  /** Status verdict from extraction + verification stage. */
  status:
    | 'ok'
    | 'rejected_thin_source'
    | 'rejected_fetch_failed'
    | 'rejected_extraction_failed';
  /** Human-readable note when status !== 'ok'. */
  note?: string;
  /**
   * Source text that backed the extraction (truncated to 14k chars).
   * Used by pre-Phase-A grounding as the substring corpus when a draft cites a
   * number that wasn't in the top-N extracted claims. NOT persisted to post_queue
   * (chain strips it before status transitions to keep payload jsonb compact).
   */
  source_text?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy (Strategist output)
// ─────────────────────────────────────────────────────────────────────────────

export type EngagementTrigger =
  | 'death_declaration'
  | 'insider_access'
  | 'identity_provocation'
  | 'simple_framework'
  | 'news_roundup';

export type CtaRole = 'save' | 'DM' | 'share';

export type BriefConstraint =
  | 'numbers_allowed'
  | 'narrative_only_no_numbers'
  | 'opinion_only';

export type Format = 'carousel' | 'single_image';

export type ContentType =
  | 'data_driven'
  | 'opinion'
  | 'news'
  | 'framework'
  | 'story'
  | 'analysis';

export interface Strategy {
  pillar: string;
  pillar_id: string | null;
  engagement_trigger: EngagementTrigger;
  recipe_name: string;
  recipe_id: string | null;
  recipe_format: Format;
  recipe_theme_code: string | null;
  /** Serialized JSON array of slide_type strings (per recipe). */
  recipe_slide_sequence: string | null;
  hook: { id: string | null; name: string; template: string };
  cta: { id: string | null; name: string; role: CtaRole; text: string };
  brief: string;
  brief_constraint: BriefConstraint;
  brief_constraint_directive: string;
  anchor_weight_tier: AnchorWeightTier | 'unknown';
  /** Subset of source_claims the post may cite. Writer is restricted to these. */
  anchor_claims: AnchorClaims;
  /** Empty string for single_image. One concrete object metaphor for carousels. */
  object_concept: string;
  /** Strategist's 1-2 sentence rationale for the recipe+trigger pick. */
  reasoning: string;
  /** Derived content type (per Session 57 routing rules). */
  content_type: ContentType;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Package (Writer-bound payload assembled from Strategy + brand_identity)
// ─────────────────────────────────────────────────────────────────────────────

export interface CaptionSpec {
  hook_max_chars: number;
  insight_range_chars: [number, number];
  application_range_chars: [number, number];
  cta_max_chars: number;
  total_target_chars: number;
  hashtag_count: number;
}

export interface LexiconForWriter {
  translations: Array<{ english: string; spanish: string; notes: string }>;
  allowed_loanwords: string[];
  banned_phrases: string[];
}

export interface BrandThemeForWriter {
  primary_color: string;
  bg_dark: string;
  bg_light: string;
  heading_font: string;
  body_font: string;
}

export interface ContextPackage {
  topic: { title: string; source_url: string; source_meta: SourceMeta };
  source_claims: AnchorClaims;
  anchor_claims: AnchorClaims;
  anchor_weight: AnchorWeight;
  strategy: Strategy;
  voice: {
    tone_tags: string;
    pillar_voice_notes: string;
    pillar_forbidden_angles: string;
  };
  lexicon: LexiconForWriter;
  brand_theme: BrandThemeForWriter;
  hashtag_pool: string;
  caption_spec: CaptionSpec;
  meta: {
    brand_slug: string;
    blueprint_version: string;
    strategist_version: string;
    assembled_at: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Writer output
// ─────────────────────────────────────────────────────────────────────────────

export interface WriterSlide {
  slide_number: number;
  slide_type: string;
  headline_text?: string;
  body_text?: string;
  accent_text?: string;
  cta_text?: string;
  person_prompt?: string;
  object_prompt?: string;
  data_items?: Array<{ number: string; label: string }>;
  /** Public URL to the rendered PNG. Set by the Designer step (Day 6). */
  url?: string;
}

export interface WriterDraft {
  format: Format;
  recipe: string;
  slides: WriterSlide[];
  caption: string;
  guardrail_violation: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Topic + envelope
// ─────────────────────────────────────────────────────────────────────────────

export interface TopicInput {
  /** Title shown on the post. */
  title: string;
  /** Source article URL (must be fetchable via Jina Reader). */
  source_url: string;
  /** Optional pre-known author/publication/date. Otherwise extracted by the LLM. */
  source_meta?: Partial<SourceMeta>;
}

/**
 * Full envelope — filled progressively by the chain.
 * `null` = step not yet run. Step ordering matches the linear status enum
 * in `post_queue.status`.
 */
export interface PostEnvelope {
  /** Brand UUID (FK to brands.id). */
  brand_id: string;
  /** Brand slug (denormalized for log convenience). */
  brand_slug: string;
  /** Stable per-post ID for idempotency. Format: "{brand_slug}:{topic_hash}". */
  idempotency_key: string;
  /** The input topic. */
  topic: TopicInput;

  /** Set after Strategist's claim-extraction step (D-012). */
  extraction?: ExtractionResult;

  /** Set after Strategist's strategy-decision step (Day 4). */
  strategy?: Strategy;

  /** Set after assembling the Writer-bound Context Package (Day 4). */
  context_package?: ContextPackage;

  /** Set after Writer step (Day 4). */
  draft?: WriterDraft;

  /** Set after grounding-check step (D-012). */
  grounding?: {
    verdict: 'pass' | 'revise' | 'kill';
    offending: Array<{ source: string; value: string; reason: string }>;
  };

  /** Telemetry that accumulates across steps. */
  telemetry: {
    step_durations_ms: Record<string, number>;
    anthropic_usage: Record<string, {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
    }>;
  };
}
