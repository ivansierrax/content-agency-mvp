/**
 * Sentry initialization wrapper.
 * Single entry-point so we can swap behavior per environment.
 */

import * as Sentry from '@sentry/node';
import type { Env } from './env.js';

let initialized = false;

export function initSentry(env: Env): void {
  if (initialized) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
    sendDefaultPii: false,
  });
  initialized = true;
}

export function captureException(err: unknown, context: Record<string, unknown> = {}): void {
  Sentry.captureException(err, { extra: context });
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = 'info', context: Record<string, unknown> = {}): void {
  Sentry.captureMessage(message, { level, extra: context });
}

export async function flushSentry(timeoutMs = 2000): Promise<void> {
  await Sentry.flush(timeoutMs);
}

export function setBrandContext(brandId: string, brandSlug: string): void {
  Sentry.setTag('brand_id', brandId);
  Sentry.setTag('brand_slug', brandSlug);
}
