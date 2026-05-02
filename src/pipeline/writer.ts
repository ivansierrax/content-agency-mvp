/**
 * Writer (first LLM-author step) — port of n8n's "Build Writer Prompt" + "Claude: Write"
 * + "Parse + Validate + Patch" from workflow `uNFrmhzbddDfxFbU`.
 *
 * Single LLM call that produces ONE draft (caption + slides) from a ContextPackage.
 *
 * Modes:
 *   - 'fresh'   — first attempt for this topic.
 *   - 'rewrite' — patch mode: caller passes rewrite_feedback (e.g. from pre-Phase-A
 *                 grounding 'revise' verdict, or QG Phase A revise verdict).
 *                 The prompt instructs Sonnet to apply a SURGICAL patch — preserve
 *                 everything that worked, change only what feedback names.
 *
 * Validation here is structural only (slides array shape, caption non-empty,
 * accent_text substring of headline_text). Grounding checks live in
 * `verifyDraftGrounding()`; the LLM-side QG Phase A is its own module.
 */

import { complete, parseModelJson } from '../lib/anthropic.js';
import type { ContextPackage, ContentType, WriterDraft, WriterSlide } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export type WriterMode = 'fresh' | 'rewrite';

export interface WriterParams {
  context_package: ContextPackage;
  brand_slug: string;
  mode?: WriterMode;
  /** Required when mode === 'rewrite'. The QG / grounding-check feedback to apply. */
  rewrite_feedback?: string;
  /** 1-based attempt counter, only used to label the patch-mode prompt. */
  rewrite_attempt?: number;
}

export async function runWriter(params: WriterParams): Promise<WriterDraft> {
  const mode: WriterMode = params.mode ?? 'fresh';
  if (mode === 'rewrite' && !params.rewrite_feedback) {
    throw new Error('runWriter: rewrite mode requires rewrite_feedback');
  }

  const cp = params.context_package;
  const systemPrompt = buildWriterSystemPrompt(cp);
  const userPrompt = buildWriterUserPrompt(mode, params.rewrite_attempt ?? 0, params.rewrite_feedback);

  const result = await complete({
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    step: mode === 'rewrite' ? 'writer_rewrite' : 'writer',
    brand_slug: params.brand_slug,
    maxTokens: 4000,
  });

  const draft = parseModelJson<WriterDraft>(result.text);
  return validateAndPatchDraft(draft, cp);
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt — verbatim port of n8n Writer (Session 57 / Blueprint v1.2)
// ─────────────────────────────────────────────────────────────────────────────

function buildWriterSystemPrompt(cp: ContextPackage): string {
  const strat = cp.strategy;
  const anchors = cp.anchor_claims;
  const lex = cp.lexicon;
  const captionSpec = cp.caption_spec;
  const voice = cp.voice;
  const brandTheme = cp.brand_theme;

  const isCarousel = strat.recipe_format === 'carousel';
  let slideSeq: string[] = [];
  if (strat.recipe_slide_sequence) {
    try {
      const parsed = JSON.parse(strat.recipe_slide_sequence);
      if (Array.isArray(parsed)) slideSeq = parsed;
    } catch {
      // ignore — Sonnet will still produce slides; structural validator catches gaps
    }
  }

  const numericStr =
    anchors.numeric_claims
      .map((n) => n.value + (n.context ? ' (' + n.context + ')' : ''))
      .join(' | ') || '(none — produce a qualitative post with zero numbers)';
  const quotesStr =
    anchors.direct_quotes
      .map((q) => '"' + q.quote + '" — ' + (q.attributed_to || 'unattributed'))
      .join(' | ') || '(none)';
  const causalStr = anchors.causal_claims.join(' | ') || '(none)';
  const entitiesArr = anchors.named_entities;
  const entitiesStr = entitiesArr.join(', ') || '(none)';
  const translationsStr =
    lex.translations.map((t) => t.english + ' → ' + t.spanish).join(' | ') || '(none)';
  const loanwordsStr = lex.allowed_loanwords.join(', ') || '(none)';
  const bannedStr = lex.banned_phrases.join(' | ') || '(none)';

  const contentTypeDirective = contentTypeDirectives[cp.strategy.content_type] ?? contentTypeDirectives.analysis;

  const slideSchemaCarousel = [
    'SLIDE FIELD SCHEMAS (use exactly):',
    '  typography_dark / typography_light:',
    '    { slide_number, slide_type, headline_text (≤80 chars UPPERCASE), body_text (≤180 chars sentence case), accent_text (1–3 words, MUST be a verbatim substring of headline_text — copy exact characters; if no clean substring fits, leave empty) }',
    '  person_photo:',
    '    { slide_number, slide_type, headline_text, body_text, accent_text, person_prompt: "" }   (leave person_prompt empty — the Designer agent fills it)',
    '  object_photo:',
    `    { slide_number, slide_type, headline_text, body_text, accent_text, object_prompt: "editorial documentary photograph of ${strat.object_concept || '[object]'}, 35mm film grain, Canon R5 50mm f/1.8, warm natural tones, leaves negative space for text overlay, NO text NO logos" }`,
    '  data_card:',
    '    { slide_number, slide_type, headline_text, accent_text, data_items: [ { number: "VERBATIM from anchor_claims.numeric_claims", label: "≤60 chars context" } ] }',
    '    If anchor_claims has ZERO numeric_claims: emit at most 2 items whose number is a qualitative noun (no invented digits).',
    '  closing_cta:',
    `    { slide_number, slide_type, cta_text: "${strat.cta.text}" }   (paste CTA verbatim; no modifications)`,
  ].join('\n');

  const slideSchemaSingle = [
    'EXACTLY ONE slide:',
    '  { slide_number: 1, slide_type: "typography_dark", headline_text (≤80 chars UPPERCASE, punchy statement), body_text (≤180 chars, supporting line), accent_text (1–3 words, MUST be a verbatim substring of headline_text — copy exact characters; if no clean substring fits, leave empty) }',
  ].join('\n');

  return [
    "You are the Writer for Hashtag Agencia's Instagram pipeline. You receive a locked context_package. Produce ONE draft in JSON. DO NOT invent. DO NOT fetch. Work only from what is below.",
    '',
    '=== CONTEXT ===',
    '',
    'TOPIC: ' + cp.topic.title,
    'BRIEF: ' + strat.brief,
    '',
    'ANCHOR CLAIMS (the ONLY facts you may cite):',
    '  numeric_claims: ' + numericStr,
    '  direct_quotes: ' + quotesStr,
    '  causal_claims: ' + causalStr,
    '  named_entities: ' + entitiesStr,
    '  source_meta: ' + JSON.stringify(cp.topic.source_meta),
    '',
    'STRATEGY:',
    '  pillar: ' + strat.pillar,
    '  engagement_trigger: ' + strat.engagement_trigger,
    '  recipe: ' + strat.recipe_name + ' (theme: ' + (strat.recipe_theme_code ?? '') + ')',
    '  format: ' + strat.recipe_format,
    '  hook_template (instantiate by filling [X] with post-specific words): "' + strat.hook.template + '"',
    '  cta_text (paste VERBATIM at caption end): "' + strat.cta.text + '"',
    '  object_concept (for object_photo slides): "' + (strat.object_concept || '(none)') + '"',
    '  slide_sequence: ' + JSON.stringify(slideSeq),
    '',
    'VOICE:',
    '  tone_tags: ' + voice.tone_tags,
    '  pillar_voice_notes: ' + voice.pillar_voice_notes,
    '  forbidden_angles: ' + voice.pillar_forbidden_angles,
    '',
    'LEXICON:',
    '  translations (apply strictly, replace English with Spanish): ' + translationsStr,
    '  allowed_loanwords (the ONLY English nouns permitted): ' + loanwordsStr,
    '  banned_phrases (NEVER use any of these): ' + bannedStr,
    '',
    'HASHTAG POOL (pick exactly ' + captionSpec.hashtag_count + '): ' + (cp.hashtag_pool || '(no pool — pick 5 relevant Spanish-language hashtags consistent with the pillar)'),
    '',
    'BRAND THEME (for your reference, not to describe):',
    '  colors: primary=' + brandTheme.primary_color + ', bg_dark=' + brandTheme.bg_dark + ', bg_light=' + brandTheme.bg_light,
    '  fonts: heading=' + brandTheme.heading_font + ', body=' + brandTheme.body_font,
    '',
    '=== BRIEF CONSTRAINT (strict — enforced by QG Phase A) ===',
    '',
    strat.brief_constraint_directive,
    'Anchor weight tier: ' + strat.anchor_weight_tier + '.',
    '',
    '=== CONTENT TYPE ADAPTATION ===',
    '',
    contentTypeDirective,
    '',
    '=== RULES (non-negotiable) ===',
    '',
    '[A] LANGUAGE: Mexican Spanish. NEVER Argentine voseo (configurás, tenés, querés). Use tú form (configuras, tienes, quieres). Apply lexicon.translations strictly. Any English noun not in allowed_loanwords must be translated.',
    '',
    '[B] GROUNDING: Cite ONLY from anchor_claims. Do NOT invent numbers, percentages, dates, named entities, OR causal/framing claims. Every numeric, named-entity, quoted, OR cause-effect / state-of-the-world claim in your output MUST match an anchor_claim verbatim (numeric/quoted) or be a faithful Spanish paraphrase of an entry in anchor_claims.causal_claims. If anchor_claims.causal_claims is empty, do NOT make claims of the form "los datos estan X", "la industria esta Y", "el mercado se esta Z" — those are causal/framing claims and they are forbidden without a source anchor. If anchor_claims.numeric_claims is empty, produce a number-free post (qualitative only). Forbidden examples (when no causal anchor exists): "los datos estan fragmentados", "la informacion esta dispersa", "el sector esta cambiando", "las empresas estan adoptando". Use rhetorical/interpretive framing instead, which is allowed: "estamos midiendo lo equivocado", "esto cambia como piensas X". SELF-CHECK BEFORE OUTPUT: scan every sentence in your draft. For each sentence claiming what IS, WAS, or WILL BE true about an industry, market, technology, product, trend, or category of people, verify it traces VERBATIM to an entry in anchor_claims (numeric, quote, OR causal). If you cannot trace it, DELETE the sentence entirely — do NOT rewrite or paraphrase. Sentences may be shorter or absent; that is acceptable. Pattern examples to scan for and remove unless anchored: "X domina/dominan/dominara/dominaran", "X es el futuro de Y", "el futuro pertenece a X", "X reemplaza/reemplazara Y", "X seguira creciendo", "lo que viene es X", "X es el nuevo Y", "X es la unica forma de Y", "todo el mundo / todas las empresas X". These are claims, not framing. They need anchors.',
    '',
    '[B2] NAMED-BRAND REQUIREMENT (BUG-S56-2 prevention): If anchor_claims.named_entities[] is non-empty (current count: ' + entitiesArr.length + '), at LEAST ONE entity name MUST appear verbatim in slide bodies, slide headlines, OR caption. Specificity = authority. A post that talks about "the company" when the source names BMW, OpenAI, etc. is generic and disqualified. Pick the entity most central to the angle and weave it in by name.',
    '',
    '[B3] SOURCE ATTRIBUTION (S57.5 fix, MISSING_SOURCE_ATTRIBUTION class): When citing ANY numeric claim, percentage, or direct quote from anchor_claims, the SAME SENTENCE (or the immediately preceding sentence) MUST contain an attribution phrase from: {"Según [publication]", "De acuerdo a [author/source]", "Reporta [publication]", "El estudio de [source] indica", "Datos de [publication]"}. Use cp.topic.source_meta.publication = "' + (cp.topic.source_meta.publication || 'unknown') + '" or cp.topic.source_meta.author = "' + (cp.topic.source_meta.author || 'unknown') + '". Never cite a number bare without saying who reported it. Example WRONG: "Solo hay 1 million de managers." Example RIGHT: "Según el ensayo de Dan Shipper en Every, solo hay 1 million de managers."',
    '',
    '[C] CAPTION ARCHITECTURE (∼' + captionSpec.total_target_chars + ' chars total, exactly 4 sections + hashtags):',
    '  1. HOOK (≤' + captionSpec.hook_max_chars + ' chars): instantiate the hook_template. Scroll-stopper. No emoji clutter.',
    '  2. INSIGHT (' + captionSpec.insight_range_chars[0] + '–' + captionSpec.insight_range_chars[1] + ' chars): the NEW thing the reader learns. Cite at least one anchor_claim verbatim. NOT a rephrase of the hook.',
    '  3. APPLICATION (' + captionSpec.application_range_chars[0] + '–' + captionSpec.application_range_chars[1] + ' chars): advance beyond insight. ONE of: (a) concrete next action, (b) frame shift, (c) stakes. NEVER a rephrase of insight.',
    '  4. CTA (≤' + captionSpec.cta_max_chars + ' chars): paste strategy.cta_text VERBATIM. Do not alter.',
    '  5. HASHTAGS: exactly ' + captionSpec.hashtag_count + ' hashtags from hashtag_pool, space-separated, on the last line.',
    '',
    '[C2] CTA-VERB ANCHOR (BUG-S56-3 prevention, BLUEPRINT v1.2 §5/§13): The strategy.cta_text already contains exactly the verb anchor required (one of: guárdalo, guarda este, dime en DM, comparte con, cuéntame, DM <keyword>). Paste it VERBATIM as section 4 of the caption. Do NOT replace with "sigue a @..." — follow-CTAs belong on closing_cta slide ONLY, never in caption body. The final non-hashtag line of the caption MUST contain that save/DM/share verb.',
    '',
    '[D] PERSONA + VOICE:',
    '  Reader: CMO / marketing director / business owner / founder with marketing budget. NEVER the operator.',
    '  Address: second-person direct tú. Say "tú haces" or "tu negocio", NEVER "tu equipo hace" (that creates an escape hatch).',
    '  Tone: imperative, no softening. Aggressiveness = refusing the reader an escape.',
    '',
    '[E] CAPTION-vs-SLIDE-1 NOVELTY (S57.5 fix, prevents CAPTION_RESTATES_SLIDE1 auto-fail at 64%+ token overlap):',
    '  Slide 1 contains the HOOK — the scroll-stopper. The caption HOOK section covers the same topic from a DIFFERENT angle, never the same claim with different verbs.',
    '  RULE: Maximum 30% token overlap between caption HOOK section and slide_1.headline_text + slide_1.body_text.',
    '  HOW: if slide 1 says "X ya murió" — caption HOOK should say "qué significa para tí" or "el costo real de seguir creyendo". Slide 1 = the claim; caption HOOK = the WHY/IMPLICATION/STAKES. Zoom out, don\'t restate.',
    '  Self-check: scan caption HOOK against slide_1 — if more than 1/3 of the words overlap (excluding stopwords), rewrite the caption HOOK from a different angle.',
    '',
    '[F] ACCENT_TEXT SUBSTRING (S57.5 fix, prevents MISSING_ACCENT auto-fail in QG Phase A): Every slide accent_text MUST be a verbatim substring of that slide headline_text. The check is mechanical: headline_text.includes(accent_text) === true. NO paraphrase, NO synonym, NO thematic phrase. HOW: pick 1-3 consecutive words FROM the exact headline_text you wrote. Copy them character-for-character. If the headline has no segment that works as a 1-3 word accent, leave accent_text empty (empty string is allowed; decorative phrases that are not in the headline are NOT). Example RIGHT: headline_text="LA CREATIVIDAD HUMANA NO SE PUEDE AUTOMATIZAR" -> accent_text="AUTOMATIZAR" or "HUMANA" or "" — all valid. Example WRONG: headline_text="LA CREATIVIDAD HUMANA NO SE PUEDE AUTOMATIZAR" + accent_text="VENTAJA COMPETITIVA" — VENTAJA COMPETITIVA is not in the headline, auto-fails. Self-check before output: for each slide that has accent_text, verify headline_text.indexOf(accent_text) >= 0 — if -1, fix it or empty it.',
    '',
    'GUARDRAILS: never mention politics, elections, religion, sex, violence, war, drugs. If the source crosses these, set guardrail_violation=true and return empty slides/caption.',
    '',
    '=== SLIDES ===',
    '',
    isCarousel
      ? 'FORMAT: carousel. Produce one slide object per entry in strategy.slide_sequence, in order.\n\n' + slideSchemaCarousel
      : 'FORMAT: single_image.\n\n' + slideSchemaSingle,
    '',
    '=== OUTPUT (JSON only, no markdown fences, no preamble) ===',
    '',
    '{',
    '  "format": "' + strat.recipe_format + '",',
    '  "recipe": "' + strat.recipe_name + '",',
    '  "slides": [ ... ],',
    '  "caption": "<full 4-section caption + hashtags on last line, \\n line breaks OK>",',
    '  "guardrail_violation": false',
    '}',
  ].join('\n');
}

const contentTypeDirectives: Record<ContentType, string> = {
  data_driven:
    'CONTENT TYPE = data_driven. Cite ONLY anchor_claims.numeric_claims VERBATIM. Never round, never extrapolate. INSIGHT MUST include at least one numeric claim with source attribution ("Según {publication}, ...").',
  opinion:
    'CONTENT TYPE = opinion. Strong POV. NO numeric claims unless anchor_claims.numeric_claims is populated AND directly relevant. Lead INSIGHT with stake-in-the-ground claim.',
  news:
    'CONTENT TYPE = news. Entity names + dates from anchor_claims.named_entities + source_meta MUST be verbatim. Lead INSIGHT with what changed/happened.',
  framework:
    'CONTENT TYPE = framework. Structure-first. NO success-rate or outcome claims. Frame as "these are the moves" not "this works X% of the time".',
  story:
    'CONTENT TYPE = story. Narrative-first. Numbers ONLY from anchor_claims.numeric_claims tied to the story. INSIGHT carries the narrative arc.',
  analysis:
    'CONTENT TYPE = analysis. Facts verbatim from anchor_claims; interpretations clearly framed ("esto significa", "lo que indica"). Distinguish what source SAYS from what you CONCLUDE.',
};

// ─────────────────────────────────────────────────────────────────────────────
// User prompt — fresh vs. rewrite (patch) mode
// ─────────────────────────────────────────────────────────────────────────────

function buildWriterUserPrompt(
  mode: WriterMode,
  attempt: number,
  feedback: string | undefined
): string {
  if (mode === 'rewrite' && feedback) {
    return [
      '=== PATCH MODE — REWRITE ATTEMPT ' + (attempt + 1) + ' ===',
      'Your previous draft failed QG. Below is the specific feedback. Apply as a SURGICAL PATCH — preserve everything that worked, change only what the feedback names. Do NOT regenerate from scratch.',
      '',
      'QUALIFIER PRESERVATION RULE (S57.5 fix, BUG-S56-02 class):',
      '  Every numeric prefix ("13.0%", "over 60%", "3.3x"), scope adjective ("mobile", "peak", "aggregated"), time anchor ("in 2024", "last quarter"), and percentage qualifier MUST be preserved verbatim when patching.',
      '  Dropping a qualifier transforms a precise statistic into an over-broad universal claim — that is a grounding violation, NOT a fix.',
      '  If the feedback names ONE specific token to remove, remove ONLY that token; never casually drop neighboring qualifiers.',
      '  EXAMPLE: source = "13.0% of TLS 1.3 traffic uses post-quantum encryption". WRONG patch: collapse to "el tráfico TLS 1.3 usa encriptación post-quantum" (drops 13.0% qualifier — universal claim). RIGHT patch: keep "13.0% del tráfico TLS 1.3 usa encriptación post-quantum" verbatim.',
      '',
      'REWRITE FEEDBACK:',
      feedback,
      '',
      '=== END PATCH MODE ===',
      '',
      'Produce the REVISED draft JSON now. Apply rules A, B, B2, C, C2, D, E strictly. The offending claims MUST be removed or replaced per the feedback above. Preserve qualifiers verbatim.',
    ].join('\n');
  }
  return 'Produce the draft JSON now. Use ONLY the context_package above. Apply rules A, B, B2, C, C2, D, E strictly.';
}

// ─────────────────────────────────────────────────────────────────────────────
// Structural validation + auto-patches that don't require another LLM call
// ─────────────────────────────────────────────────────────────────────────────

function validateAndPatchDraft(draft: WriterDraft, cp: ContextPackage): WriterDraft {
  if (typeof draft !== 'object' || draft === null) {
    throw new Error('Writer response is not an object');
  }
  if (draft.guardrail_violation === true) {
    // Caller handles — it's a valid draft shape, just flagged. Return as-is.
    return {
      format: draft.format ?? cp.strategy.recipe_format,
      recipe: draft.recipe ?? cp.strategy.recipe_name,
      slides: draft.slides ?? [],
      caption: draft.caption ?? '',
      guardrail_violation: true,
    };
  }
  if (!Array.isArray(draft.slides)) {
    throw new Error('Writer response missing slides array');
  }
  if (typeof draft.caption !== 'string' || draft.caption.length === 0) {
    throw new Error('Writer response missing caption');
  }
  if (draft.format !== cp.strategy.recipe_format) {
    // Soft-correct: align format to strategy. Sonnet sometimes echoes the wrong literal.
    draft.format = cp.strategy.recipe_format;
  }
  // Patch each slide: ensure slide_number is set, accent_text is a substring of headline.
  const patched: WriterSlide[] = draft.slides.map((s, i) => {
    const slide: WriterSlide = {
      ...s,
      slide_number: typeof s.slide_number === 'number' ? s.slide_number : i + 1,
      slide_type: s.slide_type ?? 'typography_dark',
    };
    // Rule [F] enforcement: if accent_text is non-empty but not a substring of headline_text,
    // empty it. (Empty is allowed; decorative phrases not in the headline are not.)
    if (slide.accent_text && slide.headline_text) {
      if (!slide.headline_text.includes(slide.accent_text)) {
        slide.accent_text = '';
      }
    }
    return slide;
  });
  return {
    format: draft.format,
    recipe: draft.recipe ?? cp.strategy.recipe_name,
    slides: patched,
    caption: draft.caption,
    guardrail_violation: false,
  };
}
