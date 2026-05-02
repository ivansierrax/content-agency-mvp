/**
 * QG Phase A — semantic fact-check via LLM verifier.
 *
 * Port of n8n's "Fact Check Phase A" from workflow `ulIyyThcE1jLOJ1W`, simplified
 * for the MVP single-pass design:
 *   - n8n had a corrector loop (Anchor-Pinned Corrector → re-enter Phase A) and a
 *     rewrite loop into Writer (CD v3). The MVP uses a simpler 2-step:
 *       1. Pre-Phase-A grounding (mechanical, already built — `verifyDraftGrounding`).
 *       2. Writer rewrite (single attempt, in patch mode) if pre-Phase-A says revise.
 *       3. QG Phase A (semantic, LLM) — pass / revise / kill.
 *     If Phase A returns 'revise', orchestrator hands back to Writer once more.
 *     If Phase A returns 'kill' OR the second Writer attempt still fails Phase A,
 *     the post is marked failed.
 *
 * The Anchor-Pinned Corrector is intentionally OUT. Its purpose was to surgically
 * fix offending claims without paying for a full Writer rewrite, but in practice
 * Writer's patch mode (with rewrite_feedback) handles this with one fewer LLM step
 * and one fewer parse failure mode.
 */

import { complete, parseModelJson } from '../lib/anthropic.js';
import type { AnchorClaims, WriterDraft } from './types.js';

export type PhaseAVerdict = 'pass' | 'revise' | 'kill';

export interface OffendingClaim {
  claim: string;
  category: 'numeric' | 'entity' | 'quote' | 'causal';
  reason: string;
  suggested_fix: string;
}

export interface PhaseAResult {
  verdict: PhaseAVerdict;
  offending_claims: OffendingClaim[];
  verified_count: number;
  total_claims_checked: number;
  notes: string;
}

interface PhaseALLMResponse {
  verdict?: PhaseAVerdict;
  offending_claims?: OffendingClaim[];
  verified_count?: number;
  total_claims_checked?: number;
  notes?: string;
}

export interface RunPhaseAParams {
  draft: WriterDraft;
  anchor_claims: AnchorClaims;
  brand_slug: string;
}

export async function runPhaseA(params: RunPhaseAParams): Promise<PhaseAResult> {
  const draftText = formatDraftForVerification(params.draft);
  if (!draftText.trim()) {
    return {
      verdict: 'pass',
      offending_claims: [],
      verified_count: 0,
      total_claims_checked: 0,
      notes: 'empty_draft_skipped',
    };
  }

  const systemPrompt = buildPhaseASystemPrompt(params.anchor_claims);
  const userPrompt = 'DRAFT TO VERIFY:\n\n' + draftText + '\n\nCheck every claim. Output JSON only.';

  let response: PhaseALLMResponse;
  try {
    const llm = await complete({
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      step: 'qg_phase_a',
      brand_slug: params.brand_slug,
      maxTokens: 2500,
    });
    response = parseModelJson<PhaseALLMResponse>(llm.text);
  } catch (err) {
    // On Phase A infra failure: pass through (don't block on infrastructure).
    // Mirrors n8n behavior. Day 9 reliability hardening can revisit (e.g. retry).
    return {
      verdict: 'pass',
      offending_claims: [],
      verified_count: 0,
      total_claims_checked: 0,
      notes: `phase_a_skipped: api_error: ${(err as Error).message.substring(0, 150)}`,
    };
  }

  return {
    verdict: response.verdict ?? 'pass',
    offending_claims: response.offending_claims ?? [],
    verified_count: response.verified_count ?? 0,
    total_claims_checked: response.total_claims_checked ?? 0,
    notes: response.notes ?? '',
  };
}

// Format the draft into one verifiable text blob: caption + slide content joined.
function formatDraftForVerification(draft: WriterDraft): string {
  const slidePieces = draft.slides.map((s) => {
    const parts: string[] = [];
    if (s.headline_text) parts.push(s.headline_text);
    if (s.body_text) parts.push(s.body_text);
    if (s.accent_text) parts.push(s.accent_text);
    if (s.cta_text) parts.push(s.cta_text);
    if (Array.isArray(s.data_items)) {
      for (const d of s.data_items) {
        if (d.number) parts.push(`${d.number} ${d.label ?? ''}`);
      }
    }
    return parts.join(' | ');
  });
  return (draft.caption + '\n---\n' + slidePieces.join('\n')).substring(0, 6000);
}

function buildPhaseASystemPrompt(anchor_claims: AnchorClaims): string {
  const numStr =
    anchor_claims.numeric_claims
      .map((n) => '  - ' + n.value + (n.context ? ' (' + n.context + ')' : ''))
      .join('\n') || '  (none)';
  const quoteStr =
    anchor_claims.direct_quotes
      .map((q) => '  - "' + q.quote + '" — ' + (q.attributed_to || 'unattributed'))
      .join('\n') || '  (none)';
  const causalStr = anchor_claims.causal_claims.map((c) => '  - ' + c).join('\n') || '  (none)';
  const entitiesStr = anchor_claims.named_entities.join(', ') || '(none)';

  return [
    'You are the Fact Check Phase A gate for Hashtag Agencia Instagram. You verify every numeric, named-entity, quoted, and causal claim in a draft against source_claims extracted at ingestion.',
    '',
    'Rigor: "100% truthful or nothing." Either the source says it or the post dies.',
    '',
    '=== SOURCE CLAIMS (the ONLY verified facts available) ===',
    '',
    'numeric_claims:',
    numStr,
    '',
    'direct_quotes:',
    quoteStr,
    '',
    'causal_claims:',
    causalStr,
    '',
    'named_entities: ' + entitiesStr,
    '',
    'source_meta: ' + JSON.stringify(anchor_claims.source_meta),
    '',
    '=== RULES ===',
    '',
    '1. Every numeric value in the draft (percentage, dollar, year, count, multiplier, ranking) MUST match a numeric_claim verbatim.',
    '2. Every named entity (company, product, person, platform) mentioned in the draft MUST appear in named_entities.',
    '3. Every quoted statement (text in quotation marks) MUST match a direct_quote verbatim (after translation to Spanish if the source was English — then the verbatim match is the Spanish translation).',
    '4. Every causal claim in the draft MUST be derivable from a causal_claim. Faithful Spanish paraphrase of a causal_claim is acceptable. Inventing a new cause-effect is NOT.',
    '5. Rhetorical/interpretive statements ("estamos midiendo lo equivocado") are NOT claims — skip them.',
    "6. Brand names that are the topic of the post (Meta, Google, etc.) are allowed if they're in named_entities.",
    '',
    '=== VERDICT ===',
    '',
    '- "pass": every verifiable claim has a source anchor. Post proceeds.',
    '- "revise": at least one claim has no source anchor, but the post is savable with a surgical patch (e.g., replace invented number with qualitative "sin cifras públicas").',
    '- "kill": fabrication is structural (multiple invented numbers, invented quotes attributed to real entities, invented causal stories) and not fixable without regeneration. Rare.',
    '',
    '=== OUTPUT JSON (no markdown fences, no preamble) ===',
    '',
    '{',
    '  "verdict": "pass" | "revise" | "kill",',
    '  "offending_claims": [ { "claim": "verbatim offending text", "category": "numeric|entity|quote|causal", "reason": "why no source anchor", "suggested_fix": "remove or replace with X" } ],',
    '  "verified_count": <int>,',
    '  "total_claims_checked": <int>,',
    '  "notes": "1–2 sentence summary"',
    '}',
  ].join('\n');
}
