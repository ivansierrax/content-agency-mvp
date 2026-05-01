#!/usr/bin/env node
/**
 * content_agency_mvp — entry point
 *
 * Day 1: minimal smoke that proves the deploy path works end-to-end.
 *   - Loads env (fails loud if missing)
 *   - Initializes Sentry
 *   - Logs a heartbeat
 *   - If --throw is passed, throws a test error to verify Sentry capture
 *
 * Day 2+: this file dispatches to the actual pipeline runner.
 */

import { loadEnv } from './lib/env.js';
import { initSentry, captureException, flushSentry } from './lib/sentry.js';

async function main(): Promise<number> {
  const env = loadEnv();
  initSentry(env);

  const args = new Set(process.argv.slice(2));
  const isThrowTest = args.has('--throw');

  console.log('[content_agency_mvp] booted', {
    env: env.SENTRY_ENVIRONMENT,
    nodeVersion: process.version,
    sentryEnabled: Boolean(env.SENTRY_DSN),
  });

  if (isThrowTest) {
    console.log('[content_agency_mvp] --throw flag detected; firing test error...');
    try {
      throw new Error('Day 1 Sentry smoke test — this error is intentional and confirms the deploy path captures errors.');
    } catch (err) {
      captureException(err, { source: 'day1-smoke' });
      await flushSentry(2000);
      console.log('[content_agency_mvp] error captured + Sentry flushed; exiting with code 1');
      return 1;
    }
  }

  console.log('[content_agency_mvp] no work to do (Day 1 placeholder); exiting cleanly');
  await flushSentry(2000);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch(async (err) => {
    console.error('[content_agency_mvp] FATAL', err);
    captureException(err, { source: 'main-unhandled' });
    await flushSentry(5000);
    process.exit(2);
  });
