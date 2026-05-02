/**
 * Strategist (Strategy Decision step) — single-topic LLM port of n8n's
 * Strategy Decision node from workflow `UR5qfUcOoO6djxIP`.
 *
 * One Sonnet call decides per topic:
 *   - pillar
 *   - engagement_trigger
 *   - recipe_name + format
 *   - hook_template_name
 *   - cta_role + cta_name
 *   - brief (~400 chars, CMO-facing tú)
 *   - anchor_claims (subset of source_claims the post may cite)
 *   - object_concept (carousel only)
 *   - brief_constraint (matches anchor_weight.tier)
 *
 * Differences from n8n:
 *   - Single topic in / single Strategy out (no pool selection, no slot assignment).
 *   - brand_identity is read from Postgres jsonb (Day 5 sync target) instead of
 *     a per-run Notion fetch.
 *   - Defensive against partial brand_identity — Brand 0 isn't fully synced yet.
 *     Empty arrays render as "(none)" in the prompt; Sonnet adapts.
 *
 * Same prompt body as production. Same tier-to-recipe-class routing. Same hard
 * constraints (min_metrics ≤ numeric, min_brands ≤ entities, requires_quote logic).
 *
 * Caller is responsible for passing the BrandIdentity row from Postgres.
 * On any LLM error or malformed JSON, throws — Day 4 caller handles by marking
 * post_queue.status = 'failed', failure_category = 'strategist_error'.
 */

import { complete, parseModelJson } from '../lib/anthropic.js';
import type { BrandIdentity } from '../db/types.js';
import type {
  AnchorClaims,
  ContentType,
  EngagementTrigger,
  ExtractionResult,
  Strategy,
  TopicInput,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// brand_identity adapters (Notion-mirrored jsonb → prompt-friendly strings)
//
// brand_identity is whatever Day-5 sync puts there. We treat each "row" as a
// loose record with optional fields — Notion adds fields, we don't break.
// ─────────────────────────────────────────────────────────────────────────────

interface PillarRow {
  id?: string;
  name?: string;
  short_code?: string;
  description?: string;
  preferred_recipes?: string[];
  voice_notes?: string;
  forbidden_angles?: string;
  hashtag_seed_pool?: string;
  [k: string]: unknown;
}

interface RecipeRow {
  id?: string;
  name?: string;
  format?: 'carousel' | 'single_image';
  data_card_eligibility?: string;
  trigger_match?: string[];
  min_metrics?: number;
  min_brands?: number;
  requires_quote?: boolean;
  notes?: string;
  slide_sequence_json?: string;
  theme_code?: string;
  [k: string]: unknown;
}

interface HookRow {
  id?: string;
  name?: string;
  trigger?: string;
  template?: string;
  [k: string]: unknown;
}

interface CtaRow {
  id?: string;
  name?: string;
  pillar?: string;
  role?: string;
  text?: string;
  [k: string]: unknown;
}

interface LexiconRow {
  type?: string;
  spanish?: string;
  english?: string;
  name?: string;
  notes?: string;
  [k: string]: unknown;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function pillarsToPromptStr(pillars: PillarRow[]): string {
  if (pillars.length === 0) return '(none — pick the most apt pillar name based on the topic)';
  return pillars
    .map((p) => {
      const code = p.short_code ? ` (${p.short_code})` : '';
      const prefers = p.preferred_recipes?.length
        ? ' prefers:' + p.preferred_recipes.join('/')
        : '';
      const desc = p.description ? ' — ' + p.description.substring(0, 140) : '';
      return `- ${p.name}${code}${prefers}${desc}`;
    })
    .join('\n');
}

function recipesToPromptStr(recipes: RecipeRow[]): string {
  if (recipes.length === 0) {
    return '(none — pick a recipe by descriptive name based on tier and trigger)';
  }
  return recipes
    .map((r) => {
      const triggers = (r.trigger_match || []).join(',');
      const notes = r.notes ? ' | ' + r.notes.substring(0, 120) : '';
      return `- ${r.name} | format=${r.format} | data_card=${r.data_card_eligibility} | triggers=${triggers} | min_metrics=${r.min_metrics ?? 0} | min_brands=${r.min_brands ?? 0} | requires_quote=${r.requires_quote ? 'yes' : 'no'}${notes}`;
    })
    .join('\n');
}

function hooksToPromptStr(hooks: HookRow[]): string {
  if (hooks.length === 0) return '(none — invent a short hook template using [X] placeholders)';
  return hooks.map((h) => `- [${h.name}] trigger=${h.trigger} → ${h.template}`).join('\n');
}

function ctasToPromptStr(ctas: CtaRow[]): string {
  if (ctas.length === 0) return '(none — produce a save/DM/share CTA matching the chosen pillar)';
  return ctas.map((c) => `- [${c.name}] pillar=${c.pillar} role=${c.role} → ${c.text}`).join('\n');
}

function bannedPhrasesToPromptStr(lexicon: LexiconRow[]): string {
  const banned = lexicon
    .filter((l) => l.type === 'banned_phrase')
    .map((l) => '- ' + (l.spanish || l.english || l.name));
  return banned.length ? banned.join('\n') : '(none)';
}

// ─────────────────────────────────────────────────────────────────────────────
// Anchor claims serialization for the prompt
// ─────────────────────────────────────────────────────────────────────────────

function topicToPromptStr(
  topic: TopicInput,
  extraction: ExtractionResult
): string {
  const cs = extraction.claims;
  const meta = cs.source_meta;
  const aw = extraction.anchor_weight;
  const nums = cs.numeric_claims
    .slice(0, 8)
    .map((x) => x.value + (x.context ? ' (' + x.context + ')' : ''))
    .join(' | ');
  const quotes = cs.direct_quotes
    .slice(0, 5)
    .map((x) => '"' + x.quote + '" — ' + x.attributed_to)
    .join(' | ');
  const causal = cs.causal_claims.slice(0, 8).join(' | ');
  const entities = cs.named_entities.slice(0, 12).join(', ');
  return [
    'TOPIC:',
    `  headline: ${topic.title}`,
    `  source_url: ${topic.source_url}`,
    `  publication: ${meta.publication || 'unknown'}`,
    `  author/date: ${meta.author || '?'} / ${meta.date || '?'}`,
    `  anchor_weight: tier=${aw.tier} | numeric=${aw.numeric} quotes=${aw.quotes} causal=${aw.causal} entities=${aw.entities}`,
    `  numeric_claims: ${nums || '(none)'}`,
    `  direct_quotes: ${quotes || '(none)'}`,
    `  causal_claims: ${causal || '(none)'}`,
    `  named_entities: ${entities || '(none)'}`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Brief constraint directive (mirrors n8n)
// ─────────────────────────────────────────────────────────────────────────────

function briefConstraintDirective(constraint: string): string {
  if (constraint === 'opinion_only') {
    return 'OPINION-ONLY TOPIC: zero numeric claims permitted. Work the angle with entities, causal framing, and voice. ANY number in your output = auto-reject.';
  }
  if (constraint === 'narrative_only_no_numbers') {
    return 'NARRATIVE-THIN TOPIC: do NOT introduce numbers beyond the anchor_claims. Zero fabrication. Prefer causal + entity + quote-based arguments.';
  }
  return 'Numbers permitted ONLY from anchor_claims.numeric_claims (verbatim). No invention.';
}

// ─────────────────────────────────────────────────────────────────────────────
// Content type derivation (Session 57 deterministic routing)
// ─────────────────────────────────────────────────────────────────────────────

function deriveContentType(
  trigger: string,
  pillar: string,
  numeric: number,
  quotes: number
): ContentType {
  if (trigger === 'news_roundup') return 'news';
  if (trigger === 'simple_framework') return 'framework';
  if (trigger === 'death_declaration') return numeric >= 3 ? 'data_driven' : 'opinion';
  if (trigger === 'identity_provocation') return 'opinion';
  if (trigger === 'insider_access') return quotes >= 1 ? 'story' : 'analysis';
  if (pillar === 'Industry News' || pillar === 'Thought Leadership') return 'analysis';
  return 'analysis';
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM response shape (single-topic version of n8n's `selected[0]`)
// ─────────────────────────────────────────────────────────────────────────────

interface StrategistLLMResponse {
  pillar: string;
  engagement_trigger: EngagementTrigger;
  recipe_name: string;
  format: 'carousel' | 'single_image';
  hook_template_name: string;
  cta_role: 'save' | 'DM' | 'share';
  cta_name: string;
  brief: string;
  anchor_claims: AnchorClaims;
  object_concept?: string;
  brief_constraint?: 'numbers_allowed' | 'narrative_only_no_numbers' | 'opinion_only';
  reasoning?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level decideStrategy
// ─────────────────────────────────────────────────────────────────────────────

export interface DecideStrategyParams {
  topic: TopicInput;
  extraction: ExtractionResult;
  brand_identity: BrandIdentity;
  brand_slug: string;
}

export async function decideStrategy(params: DecideStrategyParams): Promise<Strategy> {
  if (params.extraction.status !== 'ok') {
    throw new Error(
      `decideStrategy: extraction not ok (status=${params.extraction.status}, note=${params.extraction.note ?? ''})`
    );
  }

  const pillars = asArray<PillarRow>(params.brand_identity.pillars);
  const recipes = asArray<RecipeRow>(params.brand_identity.recipes);
  const hooks = asArray<HookRow>(params.brand_identity.hooks);
  const ctas = asArray<CtaRow>(params.brand_identity.ctas);
  const lexicon = asArray<LexiconRow>(params.brand_identity.lexicon);

  const systemPrompt = buildStrategistSystemPrompt({
    pillarsStr: pillarsToPromptStr(pillars),
    recipesStr: recipesToPromptStr(recipes),
    hooksStr: hooksToPromptStr(hooks),
    ctasStr: ctasToPromptStr(ctas),
    bannedStr: bannedPhrasesToPromptStr(lexicon),
  });

  const userPrompt =
    topicToPromptStr(params.topic, params.extraction) +
    '\n\nDecide everything for this topic. JSON only.';

  const result = await complete({
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    step: 'strategist',
    brand_slug: params.brand_slug,
    maxTokens: 2500,
  });

  const decision = parseModelJson<StrategistLLMResponse>(result.text);
  validateStrategistResponse(decision);

  // Look up Postgres-side IDs for chosen rows so downstream (Notion writeback,
  // analytics joins) can correlate without re-querying by name.
  const pillarRow = pillars.find((p) => p.name === decision.pillar);
  const recipeRow = recipes.find((r) => r.name === decision.recipe_name);
  const hookRow = hooks.find((h) => h.name === decision.hook_template_name);
  const ctaRow = ctas.find((c) => c.name === decision.cta_name);

  const tier = params.extraction.anchor_weight.tier;
  const brief_constraint =
    decision.brief_constraint ??
    (tier === 'data-rich' || tier === 'narrative-strong'
      ? 'numbers_allowed'
      : tier === 'narrative-thin'
      ? 'narrative_only_no_numbers'
      : 'opinion_only');

  const numeric = params.extraction.anchor_weight.numeric;
  const quotes = params.extraction.anchor_weight.quotes;

  const strategy: Strategy = {
    pillar: decision.pillar,
    pillar_id: pillarRow?.id ?? null,
    engagement_trigger: decision.engagement_trigger,
    recipe_name: decision.recipe_name,
    recipe_id: recipeRow?.id ?? null,
    recipe_format: decision.format,
    recipe_theme_code: recipeRow?.theme_code ?? null,
    recipe_slide_sequence: recipeRow?.slide_sequence_json ?? null,
    hook: {
      id: hookRow?.id ?? null,
      name: decision.hook_template_name,
      template: hookRow?.template ?? '',
    },
    cta: {
      id: ctaRow?.id ?? null,
      name: decision.cta_name,
      role: decision.cta_role,
      text: ctaRow?.text ?? '',
    },
    brief: decision.brief,
    brief_constraint,
    brief_constraint_directive: briefConstraintDirective(brief_constraint),
    anchor_weight_tier: tier,
    anchor_claims: decision.anchor_claims,
    object_concept: decision.object_concept ?? '',
    reasoning: decision.reasoning ?? '',
    content_type: deriveContentType(decision.engagement_trigger, decision.pillar, numeric, quotes),
  };

  return strategy;
}

function validateStrategistResponse(d: StrategistLLMResponse): void {
  const required: Array<keyof StrategistLLMResponse> = [
    'pillar',
    'engagement_trigger',
    'recipe_name',
    'format',
    'hook_template_name',
    'cta_role',
    'cta_name',
    'brief',
    'anchor_claims',
  ];
  for (const k of required) {
    if (d[k] === undefined || d[k] === null || d[k] === '') {
      throw new Error(`Strategist response missing required field: ${k}`);
    }
  }
  if (d.format !== 'carousel' && d.format !== 'single_image') {
    throw new Error(`Strategist response invalid format: ${d.format}`);
  }
  const triggers: EngagementTrigger[] = [
    'death_declaration',
    'insider_access',
    'identity_provocation',
    'simple_framework',
    'news_roundup',
  ];
  if (!triggers.includes(d.engagement_trigger)) {
    throw new Error(`Strategist response invalid engagement_trigger: ${d.engagement_trigger}`);
  }
  if (!['save', 'DM', 'share'].includes(d.cta_role)) {
    throw new Error(`Strategist response invalid cta_role: ${d.cta_role}`);
  }
  const ac = d.anchor_claims;
  if (!ac || typeof ac !== 'object') {
    throw new Error('Strategist response missing anchor_claims object');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt — verbatim port from n8n Strategy Decision, single-topic mode
// ─────────────────────────────────────────────────────────────────────────────

function buildStrategistSystemPrompt(parts: {
  pillarsStr: string;
  recipesStr: string;
  hooksStr: string;
  ctasStr: string;
  bannedStr: string;
}): string {
  return [
    'You are the Content Strategist for a Hashtag Agencia client. The audience is CMOs, marketing directors, business owners — NEVER operators.',
    '',
    'Your job: for the ONE topic provided, make ALL creative decisions. Every decision must cite an EXISTING row name from the Creative Config when one exists. If a config section is empty, pick a sensible name yourself but flag it in `reasoning`.',
    '',
    'LANGUAGE: Mexican Spanish ONLY. NEVER Argentine voseo (configurás, tenés, querés). Use tú form (configuras, tienes, quieres). Brief, hook instances, object concepts — all tú form.',
    '',
    '=== CREATIVE CONFIG ===',
    '',
    'PILLARS (all active):',
    parts.pillarsStr,
    '',
    'CONTENT RECIPES (all active, with format + eligibility):',
    parts.recipesStr,
    '',
    'HOOK BANK (all active, grouped by trigger):',
    parts.hooksStr,
    '',
    'CTA BANK (all active, pillar x role):',
    parts.ctasStr,
    '',
    'BANNED PHRASINGS (never use in brief):',
    parts.bannedStr,
    '',
    '=== DECISION RULES ===',
    '',
    'RECIPE SELECTION (evidence-first — NO FABRICATION PRESSURE):',
    '- HARD CONSTRAINT: picked recipe min_metrics must be ≤ topic anchor_weight.numeric, AND min_brands ≤ anchor_weight.entities. If requires_quote=yes, topic must have ≥1 direct_quote. Violating this forces Writer to fabricate and guarantees QG Phase A kill.',
    '- Tier-to-recipe-class routing:',
    '    • tier=data-rich (≥3 numeric AND ≥1 entity) → DEATH_DATA, LISTICLE, DEEP_DIVE, or any data-heavy carousel allowed.',
    '    • tier=narrative-strong (≥1 numeric AND ≥1 causal AND ≥2 entity) → DEATH_NARRATIVE, INSIDER_REVEAL, FRAMEWORK_STEPS preferred.',
    '    • tier=narrative-thin (only 1 numeric OR 1 quote) → RESTRICTED to DEATH_NARRATIVE, INSIDER_REVEAL, PUNCH_SINGLE, IDENTITY_CONFRONT. NEVER pick a recipe with min_metrics ≥ 2.',
    '    • tier=opinion-only (no numeric, no quote) → RESTRICTED to IDENTITY_CONFRONT or PUNCH_SINGLE. data_card_eligibility must be forbidden or optional.',
    "- Respect each Recipe row's Data Card Eligibility AND Trigger Match.",
    "- Format is inherited from the recipe's Format field.",
    '- If no recipe satisfies the hard constraint, pick the most permissive recipe class for the tier and note the substitution in `reasoning`.',
    '',
    'HOOK SELECTION:',
    '- Filter Hook Bank by chosen engagement_trigger.',
    '- Pick the template whose structure best fits the topic angle.',
    '- Use the EXACT Name from Hook Bank (e.g., "Identity 1 — measuring-wrong-work").',
    '',
    'CTA ROLE SELECTION:',
    '- Provocative / identity-challenging / "your team is wrong" → share.',
    "- Post references an asset Hashtag can offer (template, framework, stack, playbook, diagnostic) → DM.",
    "- Instructional / reference / \"here's how\" → save.",
    '',
    'CTA SELECTION:',
    '- Filter CTA Bank by chosen pillar + role. Use the exact Name.',
    '',
    'BRIEF:',
    '- ~400 chars.',
    '- CMO-facing reader (Rule D). Direct TÚ voice — never "tu equipo hace X"; say "tú haces X" or "tu negocio X".',
    '- State the angle: what will a CMO think or do after reading this?',
    '- Reference at least one specific source_claim verbatim (a number, named entity, quote, or causal claim).',
    '- Do not use any banned phrasings.',
    '- Match the tier: for narrative-thin or opinion-only topics, the brief must NOT demand numeric density — tell the Writer explicitly: "no fabrication of numbers; work the angle with entities + causal only".',
    '',
    'ANCHOR CLAIMS:',
    '- Subset of source_claims the post will actually cite (2–5 items).',
    '- Writer will be restricted to these + source_meta. No other numbers or names will be allowed downstream.',
    '',
    'OBJECT CONCEPT (ONLY for carousel recipes):',
    '- ONE concrete object metaphor that represents the core concept (content-driven, no list).',
    '- Omit or empty string if format=single_image.',
    '',
    '=== OUTPUT ===',
    '',
    'Single JSON object, no markdown fences, no preamble:',
    '{',
    '  "pillar": "<exact Pillar name>",',
    '  "engagement_trigger": "<one of: death_declaration | insider_access | identity_provocation | simple_framework | news_roundup>",',
    '  "recipe_name": "<exact Recipe name>",',
    '  "format": "<carousel | single_image>",',
    '  "hook_template_name": "<exact Hook Bank row name>",',
    '  "cta_role": "<save | DM | share>",',
    '  "cta_name": "<exact CTA Bank row name>",',
    '  "brief": "<~400 chars, CMO-facing, direct TÚ>",',
    '  "anchor_claims": {',
    '    "numeric_claims": [{"value":"","context":""}],',
    '    "direct_quotes": [{"quote":"","attributed_to":""}],',
    '    "causal_claims": [""],',
    '    "named_entities": [""],',
    '    "source_meta": {"author":"","publication":"","date":""}',
    '  },',
    '  "object_concept": "<concrete object string, or empty for single_image>",',
    '  "brief_constraint": "<one of: numbers_allowed | narrative_only_no_numbers | opinion_only — MUST match the topic anchor_weight.tier>",',
    '  "reasoning": "<why this recipe + trigger for this topic, 1–2 sentences, must reference the tier match>"',
    '}',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Package assembly (Strategy + brand_identity slices → Writer-bound payload)
//
// This used to be n8n's "Assemble + Write Context Package" step. We split the
// Notion-patch side off (Day 5 sync owns Notion writeback); this function now
// builds ONLY the in-memory payload Writer consumes.
// ─────────────────────────────────────────────────────────────────────────────

interface AssembleContextPackageParams {
  topic: TopicInput;
  extraction: ExtractionResult;
  strategy: Strategy;
  brand_identity: BrandIdentity;
  brand_slug: string;
}

const DEFAULT_CAPTION_SPEC = {
  hook_max_chars: 120,
  insight_range_chars: [150, 400] as [number, number],
  application_range_chars: [100, 200] as [number, number],
  cta_max_chars: 60,
  total_target_chars: 800,
  hashtag_count: 5,
};

const DEFAULT_BRAND_THEME = {
  primary_color: '#F01428',
  bg_dark: '#0D0D0D',
  bg_light: '#FAFAFA',
  heading_font: 'Bebas Neue',
  body_font: 'Inter',
};

export function assembleContextPackage(
  params: AssembleContextPackageParams
): import('./types.js').ContextPackage {
  const pillars = asArray<PillarRow>(params.brand_identity.pillars);
  const lexicon = asArray<LexiconRow>(params.brand_identity.lexicon);
  const themes = asArray<Record<string, unknown>>(params.brand_identity.themes);
  const photo =
    (params.brand_identity.photo as Record<string, unknown> | undefined) ?? {};

  const pillarRow = pillars.find((p) => p.name === params.strategy.pillar);
  const themeRow = (themes[0] ?? {}) as Record<string, unknown>;

  const lexiconForWriter = {
    translations: lexicon
      .filter((l) => l.type === 'translation')
      .map((l) => ({
        english: l.english ?? '',
        spanish: l.spanish ?? '',
        notes: l.notes ?? '',
      })),
    allowed_loanwords: lexicon
      .filter((l) => l.type === 'allowed_loanword')
      .map((l) => l.english ?? '')
      .filter((s) => s.length > 0),
    banned_phrases: lexicon
      .filter((l) => l.type === 'banned_phrase')
      .map((l) => l.spanish ?? l.english ?? '')
      .filter((s) => s.length > 0),
  };

  const brand_theme = {
    primary_color:
      (themeRow.primary_color as string) || DEFAULT_BRAND_THEME.primary_color,
    bg_dark: (themeRow.bg_dark as string) || DEFAULT_BRAND_THEME.bg_dark,
    bg_light: (themeRow.bg_light as string) || DEFAULT_BRAND_THEME.bg_light,
    heading_font:
      (themeRow.heading_font as string) || DEFAULT_BRAND_THEME.heading_font,
    body_font: (themeRow.body_font as string) || DEFAULT_BRAND_THEME.body_font,
  };

  return {
    topic: {
      title: params.topic.title,
      source_url: params.topic.source_url,
      source_meta: params.extraction.claims.source_meta,
    },
    source_claims: params.extraction.claims,
    anchor_claims: params.strategy.anchor_claims,
    anchor_weight: params.extraction.anchor_weight,
    strategy: params.strategy,
    voice: {
      tone_tags:
        (photo.voice_tone_tags as string) ||
        'direct · peer-authority · Mexican-casual',
      pillar_voice_notes: pillarRow?.voice_notes ?? '',
      pillar_forbidden_angles: pillarRow?.forbidden_angles ?? '',
    },
    lexicon: lexiconForWriter,
    brand_theme,
    hashtag_pool: pillarRow?.hashtag_seed_pool ?? '',
    caption_spec: DEFAULT_CAPTION_SPEC,
    meta: {
      brand_slug: params.brand_slug,
      blueprint_version: '1.2',
      strategist_version: 'mvp-day4',
      assembled_at: new Date().toISOString(),
    },
  };
}
