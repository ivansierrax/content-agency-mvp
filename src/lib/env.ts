/**
 * Validated environment loader.
 * Fails loud at boot if required vars are missing — better than silent fallbacks.
 */

export interface Env {
  NODE_ENV: 'development' | 'staging' | 'production';
  SENTRY_DSN: string;
  SENTRY_ENVIRONMENT: string;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SECRET_KEY: string;
  ANTHROPIC_API_KEY: string;
  MASTER_ENCRYPTION_KEY: string;
  PORT: number;
  /** Notion integration token. Day 5+ brand sync. */
  NOTION_API_KEY: string;
  /** Notion API version. Pinned per data_sources query format. */
  NOTION_VERSION: string;
  /** Optional shared secret for /admin/* endpoints. If unset, admin endpoints are open. */
  ADMIN_TOKEN?: string;
  /** HCTI Hosted API user ID (Day 6 Designer). */
  HCTI_USER_ID: string;
  /** HCTI Hosted API key (Day 6 Designer). */
  HCTI_API_KEY: string;
  /** Gemini API key for image generation (Day 6 Designer). */
  GEMINI_API_KEY: string;
  /** Supabase Storage bucket for rendered slide images. */
  MVP_CONTENT_BUCKET: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : fallback;
}

export function loadEnv(): Env {
  const nodeEnv = optional('NODE_ENV', 'development');
  if (!['development', 'staging', 'production'].includes(nodeEnv)) {
    throw new Error(`Invalid NODE_ENV: ${nodeEnv}`);
  }

  return {
    NODE_ENV: nodeEnv as Env['NODE_ENV'],
    SENTRY_DSN: required('SENTRY_DSN'),
    SENTRY_ENVIRONMENT: optional('SENTRY_ENVIRONMENT', nodeEnv),
    SUPABASE_URL: required('SUPABASE_URL'),
    SUPABASE_PUBLISHABLE_KEY: required('SUPABASE_PUBLISHABLE_KEY'),
    SUPABASE_SECRET_KEY: required('SUPABASE_SECRET_KEY'),
    ANTHROPIC_API_KEY: required('ANTHROPIC_API_KEY'),
    MASTER_ENCRYPTION_KEY: required('MASTER_ENCRYPTION_KEY'),
    PORT: Number(optional('PORT', '3000')),
    NOTION_API_KEY: required('NOTION_API_KEY'),
    NOTION_VERSION: optional('NOTION_VERSION', '2025-09-03'),
    HCTI_USER_ID: required('HCTI_USER_ID'),
    HCTI_API_KEY: required('HCTI_API_KEY'),
    GEMINI_API_KEY: required('GEMINI_API_KEY'),
    MVP_CONTENT_BUCKET: optional('MVP_CONTENT_BUCKET', 'mvp-content'),
    ...(process.env.ADMIN_TOKEN && process.env.ADMIN_TOKEN.trim() !== ''
      ? { ADMIN_TOKEN: process.env.ADMIN_TOKEN }
      : {}),
  };
}
