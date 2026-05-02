/**
 * Editor (Rules A+C+D) — port of n8n's "Editor: Rules A+C+D" from workflow `WV8ZxfKnLllJjcRl`.
 *
 * Single LLM call that validates and surgically patches a Writer draft against:
 *   - Rule A — Mexican Spanish (no voseo, allowed loanwords only, no banned phrases)
 *   - Rule C — APPLICATION novelty (must advance beyond INSIGHT, not paraphrase)
 *   - Rule D — Persona + voice (CMO-direct tú; no escape-hatch "tu equipo")
 *
 * Grounding (Rule B) is NOT this step's job — QG Phase A handles fact-check.
 *
 * CTA-IMMUTABLE enforcement (S57.6): closing_cta.cta_text and the caption-tail CTA
 * line are governed by CTA Bank. We force-restore from original draft if the LLM
 * tries to change them in revised_draft.
 */

import { complete, parseModelJson } from '../lib/anthropic.js';
import type { ContextPackage, WriterDraft, WriterSlide } from './types.js';

export type EditorVerdict = 'pass' | 'needs_revision';

export interface EditorResult {
  verdict: EditorVerdict;
  editor_notes: string;
  applied_revision: boolean;
  draft: WriterDraft;
}

interface EditorLLMResponse {
  verdict: EditorVerdict;
  editor_notes?: string;
  revised_draft?: {
    caption?: string;
    slides?: WriterSlide[];
  } | null;
}

export interface RunEditorParams {
  context_package: ContextPackage;
  draft: WriterDraft;
  brand_slug: string;
}

export async function runEditor(params: RunEditorParams): Promise<EditorResult> {
  const cp = params.context_package;
  const original = params.draft;
  const allowedLoanwordsStr = cp.lexicon.allowed_loanwords.join(', ') || '(none)';
  const bannedStr = cp.lexicon.banned_phrases.join(' | ') || '(none)';

  const systemPrompt = buildEditorSystemPrompt({ allowedLoanwordsStr, bannedStr });
  const userPrompt =
    'DRAFT:\n\n' +
    JSON.stringify(
      { caption: original.caption, slides: original.slides, format: original.format },
      null,
      2
    ) +
    '\n\nReview per Rules A, C, D. Output JSON only.';

  let response: EditorLLMResponse;
  try {
    const llm = await complete({
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      step: 'editor',
      brand_slug: params.brand_slug,
      maxTokens: 4000,
    });
    response = parseModelJson<EditorLLMResponse>(llm.text);
  } catch (err) {
    // Soft-fail: keep original draft, return notes. Editor is non-blocking by design.
    return {
      verdict: 'pass',
      editor_notes: `editor_call_failed: ${(err as Error).message.substring(0, 200)} (passing original draft through)`,
      applied_revision: false,
      draft: original,
    };
  }

  const verdict = response.verdict ?? 'pass';
  const notes = response.editor_notes ?? '';

  if (verdict !== 'needs_revision' || !response.revised_draft) {
    return { verdict, editor_notes: notes, applied_revision: false, draft: original };
  }

  // Apply revision, then enforce CTA immutability.
  const revisedCaption =
    typeof response.revised_draft.caption === 'string'
      ? response.revised_draft.caption
      : original.caption;
  const revisedSlides = Array.isArray(response.revised_draft.slides)
    ? response.revised_draft.slides
    : original.slides;

  const restoredSlides = restoreClosingCta(original.slides, revisedSlides);
  const restoredCaption = restoreCaptionCtaTail(original.caption, revisedCaption);

  return {
    verdict: 'needs_revision',
    editor_notes: notes,
    applied_revision: true,
    draft: {
      ...original,
      caption: restoredCaption,
      slides: restoredSlides,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CTA-immutable enforcement (S57.6)
// ─────────────────────────────────────────────────────────────────────────────

function restoreClosingCta(originalSlides: WriterSlide[], revisedSlides: WriterSlide[]): WriterSlide[] {
  const origClosing = originalSlides.find((s) => s.slide_type === 'closing_cta');
  if (!origClosing) return revisedSlides;
  return revisedSlides.map((s) => (s.slide_type === 'closing_cta' ? origClosing : s));
}

interface CtaTail {
  prefix: string;
  cta: string;
  trailer: string;
}

function getCtaTail(caption: string): CtaTail {
  if (!caption) return { prefix: '', cta: '', trailer: '' };
  const hashIdx = caption.search(/#[A-Za-zÀ-ſ]/);
  const trailer = hashIdx >= 0 ? caption.substring(hashIdx) : '';
  const before = hashIdx >= 0 ? caption.substring(0, hashIdx) : caption;
  const lines = before.split(/<br\s*\/?\s*>|\n/);
  let ctaIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line !== undefined && line.trim().length > 0) {
      ctaIdx = i;
      break;
    }
  }
  if (ctaIdx === -1) return { prefix: before, cta: '', trailer };
  const cta = (lines[ctaIdx] ?? '').trim();
  const ctaStart = before.lastIndexOf(cta);
  return {
    prefix: ctaStart >= 0 ? before.substring(0, ctaStart) : before,
    cta,
    trailer,
  };
}

function restoreCaptionCtaTail(originalCaption: string, revisedCaption: string): string {
  try {
    const orig = getCtaTail(originalCaption);
    const rev = getCtaTail(revisedCaption);
    if (orig.cta && rev.cta && orig.cta !== rev.cta) {
      return rev.prefix + orig.cta + rev.trailer;
    }
  } catch {
    // ignore — return revised as-is
  }
  return revisedCaption;
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt
// ─────────────────────────────────────────────────────────────────────────────

function buildEditorSystemPrompt(parts: {
  allowedLoanwordsStr: string;
  bannedStr: string;
}): string {
  return [
    'You are the Editor for Hashtag Agencia Instagram content. You validate Writer output against Rules A, C, D from the Blueprint.',
    '',
    '## Rules to check',
    '',
    '### Rule A — Language sanity',
    '- Mexican Spanish. NEVER Argentine voseo (configurás, tenés, querés, vos, los). Use tú (configuras, tienes, quieres).',
    '- Allowed English loanwords ONLY: ' + parts.allowedLoanwordsStr + '. Any other English noun must be translated.',
    '- NEVER use any banned phrase: ' + parts.bannedStr + '.',
    '',
    '### Rule C — APPLICATION novelty',
    'Caption = HOOK + INSIGHT + APPLICATION + CTA + hashtags.',
    'APPLICATION must advance beyond INSIGHT with:',
    '  (a) concrete next action (specific), OR',
    "  (b) frame shift (re-labels reader's identity/situation), OR",
    '  (c) stakes (consequence of not acting).',
    'FAIL if APPLICATION paraphrases INSIGHT with different verbs.',
    '',
    '### Rule D — Persona + voice',
    '- Reader = CMO / marketing director / business owner / founder. NEVER operator.',
    '- Voice = second-person direct tú. "tú haces", "tu negocio". NEVER "tu equipo hace" (escape hatch).',
    '- Tone = imperative. No softening ("tal vez", "quizás", "podrías considerar").',
    '',
    '## Scope',
    '',
    '- Review caption AND slide body/headline text.',
    '- Do NOT modify the closing_cta slide cta_text field. CTA copy is governed by CTA Bank at the strategy layer and is IMMUTABLE here.',
    '- Do NOT modify the final non-hashtag line of the caption (the CTA repeat). Same immutability rule.',
    '- If the CTA appears to violate Rule D (frames reader as messenger to a team-that-decides), FLAG IT in editor_notes (e.g. "CTA Bank Rule D concern: forwards reader to team"). DO NOT rewrite, paraphrase, or substitute the CTA. The strategy team revises CTA Bank entries separately.',
    '- Do NOT regenerate from scratch. Make surgical patches only.',
    '- Grounding (Rule B) is NOT your job — QA handles fact-check.',
    '',
    '## Output JSON (no markdown fences, no preamble)',
    '',
    '{',
    '  "verdict": "pass" | "needs_revision",',
    '  "editor_notes": "1-3 sentences. What passed, what needed fixing. Reference specific rule letters.",',
    '  "revised_draft": <full draft object identical shape OR null if verdict=pass>',
    '}',
  ].join('\n');
}
