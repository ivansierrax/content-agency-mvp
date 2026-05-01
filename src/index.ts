#!/usr/bin/env node
/**
 * content_agency_mvp — entry point
 *
 * Day 1: minimal long-running HTTP server that proves the deploy path works.
 *   - GET  /health  → 200 with service status (will populate per-brand status by Day 9)
 *   - POST /throw   → triggers a test error to verify Sentry capture
 *   - GET  /        → service identifier
 *
 * Day 2+: this server gets a /run-pipeline endpoint that triggers a brand's
 * content production cycle. Cron triggers in n8n will POST here.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadEnv } from './lib/env.js';
import { initSentry, captureException, flushSentry } from './lib/sentry.js';

const env = loadEnv();
initSentry(env);

interface Route {
  method: string;
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}

async function handleRoot(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    service: 'content_agency_mvp',
    version: '0.0.1',
    status: 'ok',
    environment: env.SENTRY_ENVIRONMENT,
  }));
}

async function handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Day 9 will replace this with per-brand status from Supabase.
  // For now: just confirms the service is responsive and Sentry is initialized.
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    sentryEnabled: Boolean(env.SENTRY_DSN),
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
    brands: [], // TODO Day 6: list active brand statuses
  }));
}

async function handleThrow(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  console.log('[content_agency_mvp] /throw invoked — firing test error...');
  try {
    throw new Error('Day 1 Sentry smoke test — intentional error to verify the deploy captures errors.');
  } catch (err) {
    captureException(err, { source: 'http-throw-endpoint' });
    await flushSentry(2000);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      status: 'error captured',
      message: 'Test error sent to Sentry — check the dashboard within 30s',
    }));
  }
}

const routes: Route[] = [
  { method: 'GET', path: '/', handler: handleRoot },
  { method: 'GET', path: '/health', handler: handleHealth },
  { method: 'POST', path: '/throw', handler: handleThrow },
];

const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  const method = req.method ?? 'GET';
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found', path, method }));
    return;
  }
  try {
    await route.handler(req, res);
  } catch (err) {
    captureException(err, { source: 'route-handler', path, method });
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal' }));
  }
});

const PORT = env.PORT;
server.listen(PORT, () => {
  console.log(`[content_agency_mvp] listening on :${PORT}`, {
    env: env.SENTRY_ENVIRONMENT,
    nodeVersion: process.version,
    sentryEnabled: Boolean(env.SENTRY_DSN),
  });
});

// Graceful shutdown — Railway sends SIGTERM on redeploy.
async function shutdown(signal: string): Promise<void> {
  console.log(`[content_agency_mvp] ${signal} received, shutting down...`);
  server.close(() => {
    console.log('[content_agency_mvp] server closed');
  });
  await flushSentry(5000);
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });

process.on('uncaughtException', (err) => {
  console.error('[content_agency_mvp] uncaughtException', err);
  captureException(err, { source: 'uncaughtException' });
  void flushSentry(5000).then(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  console.error('[content_agency_mvp] unhandledRejection', reason);
  captureException(reason instanceof Error ? reason : new Error(String(reason)), { source: 'unhandledRejection' });
});
