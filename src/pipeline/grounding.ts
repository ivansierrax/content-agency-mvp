/**
 * Pre-Phase-A grounding check (D-012).
 *
 * Replaces the n8n regex pre-flight that had BUG-S58-5. The new design:
 *   - Source of truth = anchor_claims.numeric_claims[].value
 *     (already extracted, already substring-verified by extract_claims).
 *   - Single normalization helper on BOTH sides — same function we use in
 *     extract_claims. Cannot drift. BUG-S58-5 cannot recur.
 *   - No re-fetch of source. No two-corpus comparison. No regex normalization.
 *
 * Verdict semantics match QG Phase A:
 *   - "pass": every number in draft is anchored.
 *   - "revise": at least one unanchored number — caller can re-prompt Writer.
 *   - "kill": ≥3 unanchored numbers OR ≥1 dollar/percent claim that's not
 *     in anchors. Cheap heuristic; LLM Phase A is the final word.
 */

import type { AnchorClaims } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Number extraction from draft
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pull numbers/percentages/years/multipliers/units from arbitrary text.
 * Captures forms like: 33%, 2.3x, 10k, 1,000, 1.5 billion, 2024, $2.5B, €100.
 * Skips trivial single digits unless they carry a unit (e.g. "5%").
 */
export function extractNumbersFromText(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  // Unicode multiplication sign × (×) covered explicitly.
  const re = /(\$?\d+(?:\.\d+)?(?:,\d{3})*(?:%|x|×|k|m|bn|b| ?million| ?billion| ?mil(?:lones)?)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const num = (m[1] ?? '').trim();
    if (!num) continue;
    const digits = num.replace(/[^0-9.]/g, '');
    if (digits.length >= 2 || num.includes('%') || /[xk×]/.test(num)) {
      out.push(num);
    }
  }
  return out;
}

// Single normalization helper used identically on BOTH sides.
function normalizeForNumber(s: string): string {
  return (s || '').toLowerCase().replace(/[^0-9.]/g, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Membership check against anchor_claims
// ─────────────────────────────────────────────────────────────────────────────

export interface GroundingResult {
  verdict: 'pass' | 'revise' | 'kill';
  /** Numbers that appeared in draft but are not in anchor_claims. */
  offending: Array<{
    /** Where it appeared: "caption" | "slide_N_headline" | "slide_N_body" | etc. */
    source: string;
    /** Original substring as it appears in the draft. */
    value: string;
    /** Normalized form used for the (failed) match. */
    normalized: string;
    reason: string;
  }>;
  /** Counts for telemetry. */
  stats: {
    numbers_in_draft: number;
    anchored: number;
    unanchored: number;
  };
}

interface DraftSlice {
  /** Where this text came from in the draft — e.g. "caption", "slide_2_body". */
  source: string;
  text: string;
}

/**
 * Verify every number found across draft slices is a member of anchor_claims.
 *
 * Caller is responsible for slicing the draft into labeled regions
 * (caption, each slide's headline/body/accent/data_card numbers, cta_text).
 * The function returns a verdict + offending list + telemetry stats.
 */
export function verifyDraftGrounding(
  draftSlices: DraftSlice[],
  anchor_claims: AnchorClaims
): GroundingResult {
  // Build the anchor membership set ONCE, using the SAME normalization
  // we'll apply to needles. This is the BUG-S58-5 prevention pattern.
  const anchorSet = new Set<string>();
  for (const claim of anchor_claims.numeric_claims) {
    const norm = normalizeForNumber(claim.value);
    if (norm) anchorSet.add(norm);
  }

  // Also accept years that appear in source_meta.date (e.g. "2024") — these
  // are publication dates and Writer is allowed to cite them as source attribution.
  const dateMatch = anchor_claims.source_meta?.date?.match(/^(\d{4})/);
  if (dateMatch?.[1]) anchorSet.add(dateMatch[1]);

  const offending: GroundingResult['offending'] = [];
  let numbers_in_draft = 0;
  let anchored = 0;

  for (const slice of draftSlices) {
    const numbers = extractNumbersFromText(slice.text);
    for (const num of numbers) {
      numbers_in_draft++;
      const needle = normalizeForNumber(num);
      if (needle.length < 1) continue; // skip un-normalizable
      if (anchorSet.has(needle) || [...anchorSet].some((a) => a.includes(needle) || needle.includes(a))) {
        // Bidirectional substring match handles e.g. anchor "65000" vs draft "65,000" — both
        // normalize to "65000", so .has() catches it. The substring fallback also catches
        // partial-match cases like draft "13.0%" vs anchor "13%" (different precision).
        anchored++;
      } else {
        offending.push({
          source: slice.source,
          value: num,
          normalized: needle,
          reason: 'not_in_anchor_claims.numeric_claims',
        });
      }
    }
  }

  const unanchored = offending.length;

  // Verdict heuristic:
  //  - 0 unanchored → pass
  //  - 1-2 unanchored → revise (Writer can patch surgically)
  //  - 3+ unanchored OR any $/% unanchored → kill
  let verdict: GroundingResult['verdict'];
  if (unanchored === 0) {
    verdict = 'pass';
  } else {
    const hasMoneyOrPct = offending.some((o) => /[$%]/.test(o.value));
    if (unanchored >= 3 || hasMoneyOrPct) verdict = 'kill';
    else verdict = 'revise';
  }

  return {
    verdict,
    offending,
    stats: { numbers_in_draft, anchored, unanchored },
  };
}
