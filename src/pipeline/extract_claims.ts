/**
 * Claim extraction (Strategist sub-step) — port of n8n's "Fetch Source + Extract Claims"
 * with the **substring verifier** (D-008 defense-in-depth) bolted on.
 *
 * Pipeline:
 *   1. Fetch source text via Jina Reader (text/markdown).
 *   2. If text < ~200 chars or matches bot-block / 404 patterns → reject early.
 *   3. Send text + topic to Sonnet with the verbatim extraction system prompt.
 *   4. Parse JSON.
 *   5. **Substring verifier** — for every numeric_claim and direct_quote,
 *      verify it appears in the source text after a single shared normalization.
 *      Drop any claim that doesn't. Log dropped claims for telemetry.
 *   6. Recompute anchor_weight tier from VERIFIED counts.
 *   7. Apply thin-source gate against verified counts.
 *
 * The verifier is the new architectural addition — Sonnet is told "verbatim only"
 * but can paraphrase anyway. Without verification, downstream agents inherit
 * Sonnet's hallucinations as if they were source-of-truth.
 */

import type { AnchorClaims, AnchorWeight, AnchorWeightTier, ExtractionResult, TopicInput } from './types.js';
import { complete, parseModelJson } from '../lib/anthropic.js';

const JINA_READER_BASE = 'https://r.jina.ai/';

// ─────────────────────────────────────────────────────────────────────────────
// Source fetch
// ─────────────────────────────────────────────────────────────────────────────

interface FetchResult {
  text: string;
  error: string | null;
}

async function fetchSource(url: string): Promise<FetchResult> {
  if (!url) return { text: '', error: 'no_url' };
  try {
    const res = await fetch(JINA_READER_BASE + url, {
      method: 'GET',
      headers: { Accept: 'text/markdown' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return { text: '', error: `jina_http_${res.status}` };
    }
    const text = await res.text();
    return { text, error: null };
  } catch (err) {
    return { text: '', error: (err as Error).message.substring(0, 200) };
  }
}

/** Detect Cloudflare/Akamai bot blocks + obvious 404 pages BEFORE counting as "thin". */
function isFetchFailedShape(text: string): boolean {
  if (!text || text.length < 600) return true;
  const lower = text.toLowerCase();
  if (/access denied|errors\.edgesuite\.net|attention required.*cloudflare|cf-error-details|403 forbidden|target url returned error 403/.test(lower)) {
    return true;
  }
  if (/(page not found|page no longer exists|hubspot 404|\b404\s*[-:|]\s*(not found|error|page))/.test(lower.substring(0, 600))) {
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extraction prompt — verbatim port of n8n Strategist's system prompt
// ─────────────────────────────────────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = [
  'You extract VERBATIM claims from a source article. Every claim a future post might cite must appear here exactly as the source states it.',
  '',
  'Extract four categories — verbatim only, no paraphrasing:',
  '1. NUMERIC CLAIMS: every percentage, dollar amount, multiplier, count, year, ranking, time period. Examples: "$2.5B", "150%", "3x", "2026", "40 minutes".',
  '2. NAMED ENTITIES: every company, product, platform, or person named.',
  '3. DIRECT QUOTES: every quoted sentence (in quotation marks), with attribution.',
  '4. CAUSAL CLAIMS: cause-and-effect statements the article asserts ("X drives Y", "X replaced Y", "X now does what Y used to").',
  '',
  'OUTPUT: single JSON object, no markdown fences, no preamble. Schema:',
  '{',
  '  "numeric_claims": [{"value": "verbatim", "context": "short fragment where it appeared"}],',
  '  "named_entities": ["verbatim name", ...],',
  '  "direct_quotes": [{"quote": "verbatim", "attributed_to": "name or unattributed"}],',
  '  "causal_claims": ["verbatim or minimal paraphrase of an explicit cause-effect the article states"],',
  '  "source_meta": {"author": "name or empty", "publication": "name or empty", "date": "YYYY-MM-DD or empty"}',
  '}',
  '',
  'RULES:',
  '- VERBATIM for numeric_claims and direct_quotes. If not literally in the source, DO NOT include.',
  '- No invention, no extrapolation, no "the article implies...". Only what is stated.',
  '- Cap each category at 15 most important items.',
  '- If a category has nothing, return empty array — NEVER fill with placeholders.',
  '- If the article is too thin to cite (no facts, no data, no named entities, just opinion), return all-empty and let the thin-source gate catch it downstream.',
].join('\n');

// ─────────────────────────────────────────────────────────────────────────────
// Substring verifier (D-008 / D-012 defense)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SINGLE normalization helper used on BOTH sides of every comparison.
 * Per BUG-S58-5: the n8n version had two different normalizers and that's
 * exactly the bug we're preventing.
 *
 * Strategy:
 *   - lowercase
 *   - strip ALL non-alphanumeric (commas, spaces, punctuation, currency, %)
 *
 * Two different formats of the same number ("65,000" and "65000" and "65 000")
 * all collapse to the same digit string ("65000"). Quote variants ("smart" vs
 * "dumb") collapse to the same letters.
 *
 * For numbers specifically: we then keep ONLY digits + dot (decimal). For
 * quotes: keep ONLY alphanumeric. Two variants of `normalize` to fit both.
 */
function normalizeForNumber(s: string): string {
  return (s || '').toLowerCase().replace(/[^0-9.]/g, '');
}

function normalizeForQuote(s: string): string {
  return (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

/**
 * For each numeric_claim: verify normalize(value) appears as a substring of
 * normalize(source_text). Drop if not present. Log the drop with reason.
 *
 * For each direct_quote: same idea but with quote-normalization (which keeps
 * letters, in case the source has it but in different punctuation).
 *
 * Causal claims allow paraphrase per spec — we don't strict-substring-check
 * those. Named entities are checked because the prompt says "verbatim".
 */
export function verifyClaimsAgainstSource(
  raw: AnchorClaims,
  sourceText: string
): { verified: AnchorClaims; dropped: ExtractionResult['dropped'] } {
  const dropped: ExtractionResult['dropped'] = [];
  const sourceForNumber = normalizeForNumber(sourceText);
  const sourceForQuote = normalizeForQuote(sourceText);

  const verified_numeric = raw.numeric_claims.filter((c) => {
    const needle = normalizeForNumber(c.value);
    if (needle.length < 1) {
      dropped.push({ category: 'numeric', value: c.value, context: c.context, reason: 'empty_after_normalize' });
      return false;
    }
    if (!sourceForNumber.includes(needle)) {
      dropped.push({ category: 'numeric', value: c.value, context: c.context, reason: 'not_in_source' });
      return false;
    }
    return true;
  });

  const verified_quotes = raw.direct_quotes.filter((q) => {
    const needle = normalizeForQuote(q.quote);
    if (needle.length < 8) {
      // Very short "quotes" are almost always parsing artifacts, not real attributions.
      dropped.push({ category: 'quote', value: q.quote, context: q.attributed_to, reason: 'too_short' });
      return false;
    }
    if (!sourceForQuote.includes(needle)) {
      dropped.push({ category: 'quote', value: q.quote, context: q.attributed_to, reason: 'not_in_source' });
      return false;
    }
    return true;
  });

  // Named entities and causal claims pass through unchanged. Named entities
  // get a softer check (any token of the entity must appear in source) below.
  const verified_entities = raw.named_entities.filter((e) => {
    const tokens = normalizeForQuote(e).match(/.{3,}/g) ?? [normalizeForQuote(e)];
    return tokens.some((t) => sourceForQuote.includes(t));
  });

  return {
    verified: {
      numeric_claims: verified_numeric,
      direct_quotes: verified_quotes,
      causal_claims: raw.causal_claims,
      named_entities: verified_entities,
      source_meta: raw.source_meta,
    },
    dropped,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Anchor weight classification (port of n8n logic)
// ─────────────────────────────────────────────────────────────────────────────

function classifyAnchorWeight(claims: AnchorClaims): AnchorWeight {
  const numeric = claims.numeric_claims.length;
  const quotes = claims.direct_quotes.length;
  const causal = claims.causal_claims.length;
  const entities = claims.named_entities.length;
  const total_citable = numeric + quotes + causal;
  let tier: AnchorWeightTier;
  if (numeric >= 3 && entities >= 1) tier = 'data-rich';
  else if (numeric >= 1 && causal >= 1 && entities >= 2) tier = 'narrative-strong';
  else if (numeric >= 1 || quotes >= 1) tier = 'narrative-thin';
  else tier = 'opinion-only';
  return { numeric, quotes, causal, entities, total_citable, tier };
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level extract
// ─────────────────────────────────────────────────────────────────────────────

export interface ExtractClaimsParams {
  topic: TopicInput;
  brand_slug: string;
  /** Override source text (for testing without a fetch). */
  source_text_override?: string;
}

/**
 * Full extraction pipeline: fetch → extract via LLM → verify → classify → gate.
 * Returns an `ExtractionResult` whose `status` field signals whether the topic
 * is viable for downstream Strategist + Writer.
 */
export async function extractClaims(params: ExtractClaimsParams): Promise<ExtractionResult> {
  const empty: AnchorClaims = {
    numeric_claims: [],
    direct_quotes: [],
    causal_claims: [],
    named_entities: [],
    source_meta: { author: '', publication: '', date: '' },
  };

  // 1. Fetch source
  let sourceText = params.source_text_override ?? '';
  if (!sourceText) {
    if (!params.topic.source_url) {
      return {
        claims: empty,
        anchor_weight: classifyAnchorWeight(empty),
        dropped: [],
        status: 'rejected_fetch_failed',
        note: 'no_source_url',
      };
    }
    const fetched = await fetchSource(params.topic.source_url);
    if (fetched.error) {
      return {
        claims: empty,
        anchor_weight: classifyAnchorWeight(empty),
        dropped: [],
        status: 'rejected_fetch_failed',
        note: `fetch_error: ${fetched.error}`,
      };
    }
    sourceText = fetched.text;
  }

  // 2. Bot-block / 404 / too-short detection
  if (isFetchFailedShape(sourceText)) {
    return {
      claims: empty,
      anchor_weight: classifyAnchorWeight(empty),
      dropped: [],
      status: 'rejected_fetch_failed',
      note: `fetch_failed_shape: len=${sourceText.length}`,
    };
  }

  // 3. LLM extraction
  let rawClaims: AnchorClaims;
  try {
    const userMessage =
      `TOPIC HEADLINE: ${params.topic.title}\n\nSOURCE ARTICLE (markdown):\n\n${sourceText.substring(0, 14000)}`;
    const result = await complete({
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      step: 'extract_claims',
      brand_slug: params.brand_slug,
      maxTokens: 2000,
    });
    rawClaims = parseModelJson<AnchorClaims>(result.text);
    // Normalize structure — Sonnet sometimes omits empty arrays
    rawClaims.numeric_claims = rawClaims.numeric_claims ?? [];
    rawClaims.direct_quotes = rawClaims.direct_quotes ?? [];
    rawClaims.causal_claims = rawClaims.causal_claims ?? [];
    rawClaims.named_entities = rawClaims.named_entities ?? [];
    rawClaims.source_meta = rawClaims.source_meta ?? { author: '', publication: '', date: '' };
  } catch (err) {
    return {
      claims: empty,
      anchor_weight: classifyAnchorWeight(empty),
      dropped: [],
      status: 'rejected_extraction_failed',
      note: `llm_error: ${(err as Error).message.substring(0, 200)}`,
    };
  }

  // 4. Substring verification (the headline anti-hallucination defense)
  const { verified, dropped } = verifyClaimsAgainstSource(rawClaims, sourceText);

  // 5. Classify on VERIFIED counts (not raw counts — we want tier based on truth)
  const anchor_weight = classifyAnchorWeight(verified);

  // 6. Thin-source gate (mirrors n8n logic: <2 citable + <3 entities → thin)
  if (anchor_weight.total_citable < 2 && anchor_weight.entities < 3) {
    return {
      claims: verified,
      anchor_weight,
      dropped,
      status: 'rejected_thin_source',
      note: `thin: ${anchor_weight.total_citable} citable + ${anchor_weight.entities} entities (after verify, dropped ${dropped.length})`,
    };
  }

  return {
    claims: verified,
    anchor_weight,
    dropped,
    status: 'ok',
    ...(dropped.length > 0 && { note: `verified: dropped ${dropped.length} hallucinated claim(s) — see dropped[]` }),
  };
}
