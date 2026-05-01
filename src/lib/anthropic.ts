/**
 * Anthropic SDK wrapper with prompt caching (D-002).
 *
 * Single entry point so we can swap models per-step or per-brand later without
 * touching call sites. Every call is wrapped with retry+timeout via the SDK's
 * built-ins, and emits a Sentry breadcrumb with cache hit rate so we can verify
 * caching is actually working.
 *
 * Default model = claude-sonnet-4-6 (per memory note "Always use Gemini 3 Pro" doesn't apply
 * here — that's for image gen; for text we use Sonnet 4.6 as the chain default).
 */

import Anthropic from '@anthropic-ai/sdk';
import * as Sentry from '@sentry/node';
import { loadEnv } from './env.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 4000;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  const env = loadEnv();
  client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    maxRetries: 2,        // SDK default; surfaced for visibility
    timeout: 60_000,      // 60s — long enough for Sonnet on big prompts
  });
  return client;
}

export interface CompletionParams {
  /** System prompt. Cached unless `cache: false`. */
  system: string;
  /** Conversation messages — typically a single user message for our chain. */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Override model. Default: claude-sonnet-4-6. */
  model?: string;
  /** Sampling temperature. Default: 1.0 (Anthropic default). */
  temperature?: number;
  /** Max output tokens. Default: 4000. */
  maxTokens?: number;
  /** Disable prompt caching (default: caching ON). */
  cache?: boolean;
  /** Tag for telemetry — e.g. "extract_claims", "writer", "qg_phase_a". */
  step: string;
  /** Brand context for telemetry. */
  brand_slug?: string;
}

export interface CompletionResult {
  /** The assistant's text reply. */
  text: string;
  /** Token usage breakdown. */
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  /** Effective cache hit rate: cache_read / (cache_read + input). 0 if no caching this call. */
  cache_hit_rate: number;
  /** Stop reason from Anthropic. */
  stop_reason: string | null;
  /** Model that was actually used. */
  model: string;
}

/**
 * Single-turn completion. Returns the assistant text + telemetry.
 *
 * Caching: if `cache !== false`, the system prompt is sent as a single content
 * block with `cache_control: { type: 'ephemeral' }`. Anthropic caches blocks
 * with this marker for ~5 minutes; subsequent calls with identical system text
 * return cache_read_input_tokens > 0 and pay ~10% of input cost.
 *
 * For the chain to benefit from caching, identical brand_identity → identical
 * system prompt → cache hit. Per-brand isolation is preserved automatically
 * (different brand → different prompt → different cache entry).
 */
export async function complete(params: CompletionParams): Promise<CompletionResult> {
  const model = params.model ?? DEFAULT_MODEL;
  const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
  const useCache = params.cache !== false;

  // System prompt as a content-block array so we can attach cache_control.
  // Anthropic SDK accepts string-or-array for `system`; array form lets us mark blocks.
  const systemBlocks = useCache
    ? [{ type: 'text' as const, text: params.system, cache_control: { type: 'ephemeral' as const } }]
    : params.system;

  const start = Date.now();

  const response = await getClient().messages.create({
    model,
    max_tokens: maxTokens,
    ...(params.temperature !== undefined && { temperature: params.temperature }),
    system: systemBlocks,
    messages: params.messages,
  });

  const elapsed_ms = Date.now() - start;

  // Extract text from response. We assume a single text block (chain prompts are JSON-or-text returns).
  const text = response.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // SDK 0.32 doesn't fully type cache_* fields yet — they're returned by the API
  // when cache_control is present. Cast through `unknown` for now; tighten when
  // we bump the SDK version (Day 9+ alongside generated supabase types).
  const rawUsage = response.usage as unknown as {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  const usage = {
    input_tokens: rawUsage.input_tokens ?? 0,
    output_tokens: rawUsage.output_tokens ?? 0,
    cache_creation_input_tokens: rawUsage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: rawUsage.cache_read_input_tokens ?? 0,
  };

  const totalInputTokens = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens;
  const cache_hit_rate = totalInputTokens > 0 ? usage.cache_read_input_tokens / totalInputTokens : 0;

  // Sentry breadcrumb for telemetry. Lets us see cache rate per step in the dashboard.
  Sentry.addBreadcrumb({
    category: 'anthropic',
    type: 'http',
    level: 'info',
    message: `complete[${params.step}]`,
    data: {
      step: params.step,
      brand_slug: params.brand_slug ?? null,
      model,
      elapsed_ms,
      ...usage,
      cache_hit_rate: Number(cache_hit_rate.toFixed(3)),
      stop_reason: response.stop_reason,
    },
  });

  return {
    text,
    usage,
    cache_hit_rate,
    stop_reason: response.stop_reason,
    model,
  };
}

/**
 * Try to extract a JSON object from a model response. Handles:
 *  - Pure JSON (no fences)
 *  - JSON wrapped in ```json ... ``` fences (despite our prompt asking for none)
 *  - Stray prose before/after the {} block
 *
 * Throws on unrecoverable parse failure. Caller handles per-step.
 */
export function parseModelJson<T = unknown>(raw: string): T {
  let s = raw.trim();
  // Strip code fences if Sonnet wrapped despite instructions
  if (s.startsWith('```')) {
    const nl = s.indexOf('\n');
    if (nl !== -1) s = s.substring(nl + 1);
    const lastFence = s.lastIndexOf('```');
    if (lastFence !== -1) s = s.substring(0, lastFence).trim();
  }
  // First-shot direct parse
  try {
    return JSON.parse(s) as T;
  } catch {
    // Fall back to substring extraction between first { and last }
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(s.substring(start, end + 1)) as T;
    } catch (e) {
      throw new Error(
        `parseModelJson: failed to parse extracted substring: ${(e as Error).message}; raw[0..200]=${raw.substring(0, 200)}`
      );
    }
  }
  throw new Error(`parseModelJson: no JSON object found in response; raw[0..200]=${raw.substring(0, 200)}`);
}
