/**
 * Pipeline orchestrator — wires Strategist → Writer → Grounding → Editor → Spanish → QG Phase A.
 *
 * Persistence contract:
 *   - One `post_queue` row per (brand_id, idempotency_key).
 *   - `status` advances through the linear enum (pending → strategist → writer →
 *     editor → spanish_editor → qg → ready), or `failed` on terminal error.
 *   - `payload` is the full PostEnvelope, jsonb-merged at every step boundary.
 *     This makes the chain replayable from any step (Day 9 reliability win).
 *
 * Revise-loop budget:
 *   - Pre-Phase-A grounding: 1 Writer rewrite attempt allowed.
 *   - QG Phase A: 1 Writer rewrite attempt allowed (re-runs Editor + Spanish + Phase A).
 *   - After both budgets are spent, 'revise' verdicts harden into 'failed'.
 */

import * as Sentry from '@sentry/node';
import { extractClaims } from './extract_claims.js';
import { decideStrategy, assembleContextPackage } from './strategist.js';
import { runWriter } from './writer.js';
import { verifyDraftGrounding } from './grounding.js';
import { runEditor } from './editor.js';
import { runSpanishEditor } from './spanish_editor.js';
import { runPhaseA } from './qg_phase_a.js';
import type { GroundingResult } from './grounding.js';
import type {
  ContextPackage,
  PostEnvelope,
  Strategy,
  TopicInput,
  WriterDraft,
} from './types.js';
import type { BrandIdentity, BrandRow, BrandConfigRow, PostStatus } from '../db/types.js';
import { enqueuePost, updatePostStatus, markFailed } from '../db/posts.js';
import { getBrandConfig } from '../db/brands.js';
import { createHash } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface RunChainParams {
  brand: BrandRow;
  topic: TopicInput;
  /** Override idempotency key (default: deterministic hash of source_url + title). */
  idempotency_key?: string;
}

export interface RunChainResult {
  post_queue_id: string;
  brand_id: string;
  brand_slug: string;
  status: PostStatus;
  envelope: PostEnvelope;
  /** Final failure category if status === 'failed'. */
  failure_category?: string;
  /** Convenience: true if pipeline reached 'ready'. */
  ok: boolean;
}

export async function runChain(params: RunChainParams): Promise<RunChainResult> {
  const { brand, topic } = params;
  const idempotency_key = params.idempotency_key ?? defaultIdempotencyKey(brand.slug, topic);

  // 1. Brand config (brand_identity is the Strategist's brand input)
  const config = await getBrandConfig(brand.slug);
  if (!config) {
    throw new Error(`runChain: brand_config missing for ${brand.slug}`);
  }

  // 2. Idempotent enqueue
  const envelope: PostEnvelope = {
    brand_id: brand.id,
    brand_slug: brand.slug,
    idempotency_key,
    topic,
    telemetry: { step_durations_ms: {}, anthropic_usage: {} },
  };
  const { row, created } = await enqueuePost({
    brand_id: brand.id,
    idempotency_key,
    status: 'pending',
    payload: envelopeToPayload(envelope),
  });
  const postId = row.id;
  Sentry.addBreadcrumb({
    category: 'chain',
    level: 'info',
    message: `chain.start brand=${brand.slug} post=${postId} created=${created}`,
    data: { brand_slug: brand.slug, post_id: postId, idempotency_key },
  });

  try {
    // 3. Extract claims (Strategist sub-step 1)
    envelope.extraction = await timed(envelope, 'extract_claims', () =>
      extractClaims({ topic, brand_slug: brand.slug })
    );
    if (envelope.extraction.status !== 'ok') {
      return await fail(postId, envelope, 'thin_source', envelope.extraction.note ?? envelope.extraction.status);
    }
    await updatePostStatus(postId, 'strategist', { payloadPatch: envelopeToPayload(envelope) });

    // 4. Strategist decision (Strategist sub-step 2 — single LLM call)
    envelope.strategy = await timed(envelope, 'strategist', () =>
      decideStrategy({
        topic,
        extraction: envelope.extraction!,
        brand_identity: config.brand_identity,
        brand_slug: brand.slug,
      })
    );

    // 5. Assemble Context Package (deterministic Node)
    envelope.context_package = assembleContextPackage({
      topic,
      extraction: envelope.extraction,
      strategy: envelope.strategy,
      brand_identity: config.brand_identity,
      brand_slug: brand.slug,
    });
    await updatePostStatus(postId, 'writer', { payloadPatch: envelopeToPayload(envelope) });

    // 6. Writer (with mechanical grounding revise loop, 1 attempt)
    const writerResult = await runWriterWithGroundingLoop({
      cp: envelope.context_package,
      envelope,
      brand_slug: brand.slug,
    });
    if (writerResult.terminal === 'kill') {
      envelope.draft = writerResult.draft;
      envelope.grounding = writerResult.grounding;
      return await fail(postId, envelope, 'grounding_pre_a', 'pre-Phase-A grounding kill');
    }
    if (writerResult.draft.guardrail_violation) {
      envelope.draft = writerResult.draft;
      return await fail(postId, envelope, 'guardrail_violation', 'Writer flagged guardrail violation');
    }
    envelope.draft = writerResult.draft;
    envelope.grounding = writerResult.grounding;
    await updatePostStatus(postId, 'editor', { payloadPatch: envelopeToPayload(envelope) });

    // 7. Editor (Rules A+C+D)
    const editorResult = await timed(envelope, 'editor', () =>
      runEditor({ context_package: envelope.context_package!, draft: envelope.draft!, brand_slug: brand.slug })
    );
    envelope.draft = editorResult.draft;
    await updatePostStatus(postId, 'spanish_editor', {
      payloadPatch: { ...envelopeToPayload(envelope), editor_log: editorResult.editor_notes },
    });

    // 8. Spanish Editor
    const spanishResult = await timed(envelope, 'spanish_editor', () =>
      runSpanishEditor({ draft: envelope.draft!, brand_slug: brand.slug })
    );
    envelope.draft = spanishResult.draft;
    await updatePostStatus(postId, 'qg', {
      payloadPatch: { ...envelopeToPayload(envelope), spanish_editor_log: spanishResult.log },
    });

    // 9. QG Phase A (LLM verifier) with 1 rewrite-attempt budget
    let phaseA = await timed(envelope, 'qg_phase_a', () =>
      runPhaseA({
        draft: envelope.draft!,
        anchor_claims: envelope.strategy!.anchor_claims,
        brand_slug: brand.slug,
      })
    );

    if (phaseA.verdict === 'revise') {
      // Retry: re-run Writer in patch mode with Phase A's offending claims as feedback,
      // then re-run Editor + Spanish + Phase A. One attempt only.
      const feedback = formatPhaseAFeedback(phaseA);
      envelope.draft = await timed(envelope, 'writer_phase_a_rewrite', () =>
        runWriter({
          context_package: envelope.context_package!,
          brand_slug: brand.slug,
          mode: 'rewrite',
          rewrite_feedback: feedback,
          rewrite_attempt: 1,
        })
      );

      const editorRetry = await timed(envelope, 'editor_phase_a_rewrite', () =>
        runEditor({
          context_package: envelope.context_package!,
          draft: envelope.draft!,
          brand_slug: brand.slug,
        })
      );
      envelope.draft = editorRetry.draft;

      const spanishRetry = await timed(envelope, 'spanish_editor_phase_a_rewrite', () =>
        runSpanishEditor({ draft: envelope.draft!, brand_slug: brand.slug })
      );
      envelope.draft = spanishRetry.draft;

      phaseA = await timed(envelope, 'qg_phase_a_retry', () =>
        runPhaseA({
          draft: envelope.draft!,
          anchor_claims: envelope.strategy!.anchor_claims,
          brand_slug: brand.slug,
        })
      );
    }

    if (phaseA.verdict !== 'pass') {
      return await fail(
        postId,
        envelope,
        phaseA.verdict === 'kill' ? 'phase_a_kill' : 'phase_a_revise_unrecovered',
        phaseA.notes || `Phase A returned ${phaseA.verdict}`
      );
    }

    // 10. Reached 'ready'. Designer (Day 5+) picks up from here.
    await updatePostStatus(postId, 'ready', {
      reason: 'pipeline_text_ready',
      payloadPatch: {
        ...envelopeToPayload(envelope),
        qg_phase_a: phaseA,
      },
    });

    return {
      post_queue_id: postId,
      brand_id: brand.id,
      brand_slug: brand.slug,
      status: 'ready',
      envelope,
      ok: true,
    };
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    Sentry.captureException(err, { tags: { source: 'runChain', brand_slug: brand.slug, post_id: postId } });
    await markFailed(postId, message.substring(0, 500));
    return {
      post_queue_id: postId,
      brand_id: brand.id,
      brand_slug: brand.slug,
      status: 'failed',
      envelope,
      failure_category: 'chain_error',
      ok: false,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Writer + mechanical grounding revise loop (pre-Phase-A)
// ─────────────────────────────────────────────────────────────────────────────

interface WriterLoopResult {
  draft: WriterDraft;
  grounding: GroundingResult | undefined;
  /** 'kill' if grounding cannot recover after the rewrite attempt. */
  terminal: 'continue' | 'kill';
}

async function runWriterWithGroundingLoop(params: {
  cp: ContextPackage;
  envelope: PostEnvelope;
  brand_slug: string;
}): Promise<WriterLoopResult> {
  const { cp, envelope, brand_slug } = params;

  // First-pass Writer
  let draft = await timed(envelope, 'writer', () =>
    runWriter({ context_package: cp, brand_slug, mode: 'fresh' })
  );

  if (draft.guardrail_violation) {
    return { draft, grounding: undefined, terminal: 'continue' };
  }

  // Mechanical grounding check — verify against the FULL source extraction
  // (cp.source_claims), not Strategist's curated subset (cp.anchor_claims).
  // Anchor_claims is the Writer's "stay focused" prompt input; source_claims is the
  // full set of facts the source actually said. A draft that cites a real source
  // number outside Strategist's 5-claim picks is grounded, not fabricated. QG Phase A
  // (LLM verifier) still uses anchor_claims for the "should this post focus here" check.
  let grounding = verifyDraftGrounding(draftToSlices(draft), cp.source_claims);
  if (grounding.verdict === 'pass') {
    return { draft, grounding, terminal: 'continue' };
  }
  if (grounding.verdict === 'kill') {
    return { draft, grounding, terminal: 'kill' };
  }

  // 'revise' — single Writer rewrite attempt with grounding feedback
  const feedback = formatGroundingFeedback(grounding);
  draft = await timed(envelope, 'writer_grounding_rewrite', () =>
    runWriter({
      context_package: cp,
      brand_slug,
      mode: 'rewrite',
      rewrite_feedback: feedback,
      rewrite_attempt: 1,
    })
  );
  grounding = verifyDraftGrounding(draftToSlices(draft), cp.source_claims);

  // After the rewrite, anything not 'pass' is terminal kill (single-attempt budget).
  if (grounding.verdict !== 'pass') {
    return { draft, grounding, terminal: 'kill' };
  }
  return { draft, grounding, terminal: 'continue' };
}

function draftToSlices(draft: WriterDraft): Array<{ source: string; text: string }> {
  const slices: Array<{ source: string; text: string }> = [];
  if (draft.caption) slices.push({ source: 'caption', text: draft.caption });
  draft.slides.forEach((s, i) => {
    const n = s.slide_number ?? i + 1;
    if (s.headline_text) slices.push({ source: `slide_${n}_headline`, text: s.headline_text });
    if (s.body_text) slices.push({ source: `slide_${n}_body`, text: s.body_text });
    if (s.accent_text) slices.push({ source: `slide_${n}_accent`, text: s.accent_text });
    if (Array.isArray(s.data_items)) {
      s.data_items.forEach((d, j) => {
        if (d.number) slices.push({ source: `slide_${n}_data_${j}`, text: String(d.number) });
      });
    }
  });
  return slices;
}

// ─────────────────────────────────────────────────────────────────────────────
// Feedback formatting for Writer patch mode
// ─────────────────────────────────────────────────────────────────────────────

function formatGroundingFeedback(g: GroundingResult): string {
  const lines = ['Pre-Phase-A grounding flagged unsourced numbers. Apply a surgical patch:', ''];
  for (const o of g.offending) {
    lines.push(`- [${o.source}] "${o.value}" — not in anchor_claims.numeric_claims. Remove or replace with a number that IS in anchor_claims.`);
  }
  lines.push('');
  lines.push('Do NOT regenerate. Keep everything else identical. Preserve qualifiers verbatim.');
  return lines.join('\n');
}

function formatPhaseAFeedback(phaseA: { offending_claims: Array<{ claim: string; category: string; reason: string; suggested_fix: string }>; notes: string }): string {
  const lines = [`QG Phase A flagged ${phaseA.offending_claims.length} claim(s). Apply surgical patches:`, ''];
  for (const o of phaseA.offending_claims) {
    lines.push(`- [${o.category}] "${o.claim}" — ${o.reason} → ${o.suggested_fix}`);
  }
  lines.push('');
  lines.push('Notes: ' + phaseA.notes);
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function defaultIdempotencyKey(brandSlug: string, topic: TopicInput): string {
  const h = createHash('sha256')
    .update(topic.source_url + '|' + topic.title)
    .digest('hex')
    .substring(0, 16);
  return `${brandSlug}:${h}`;
}

function envelopeToPayload(env: PostEnvelope): Record<string, unknown> {
  return env as unknown as Record<string, unknown>;
}

async function timed<T>(envelope: PostEnvelope, step: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const out = await fn();
    envelope.telemetry.step_durations_ms[step] = Date.now() - start;
    return out;
  } catch (err) {
    envelope.telemetry.step_durations_ms[step] = Date.now() - start;
    throw err;
  }
}

async function fail(
  postId: string,
  envelope: PostEnvelope,
  failure_category: string,
  reason: string
): Promise<RunChainResult> {
  await updatePostStatus(postId, 'failed', {
    reason: `${failure_category}: ${reason.substring(0, 200)}`,
    payloadPatch: {
      ...envelopeToPayload(envelope),
      failure_category,
      failure_reason: reason,
    },
  });
  return {
    post_queue_id: postId,
    brand_id: envelope.brand_id,
    brand_slug: envelope.brand_slug,
    status: 'failed',
    envelope,
    failure_category,
    ok: false,
  };
}

// Unused but keeps the import live for future use (BrandConfigRow + Strategy types referenced in JSDoc)
export type { BrandConfigRow, Strategy };
