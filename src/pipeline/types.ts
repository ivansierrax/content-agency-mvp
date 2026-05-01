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

  /**
   * Set after Strategist's strategy-decision step. Picks pillar, recipe, hook, CTA.
   * Day 4 work — typed loosely for now.
   */
  strategy?: Record<string, unknown>;

  /** Set after Writer step. Day 4 work — typed loosely for now. */
  draft?: {
    caption: string;
    slides: unknown[];
    format: 'carousel' | 'single_image';
  };

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
