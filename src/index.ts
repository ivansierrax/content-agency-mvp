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
import { initSentry, captureException, flushSentry, setBrandContext } from './lib/sentry.js';
import { checkDbHealth } from './lib/supabase.js';
import { getBrandBySlug, listBrands } from './db/brands.js';
import { extractClaims } from './pipeline/extract_claims.js';
import { runChain } from './pipeline/chain.js';
import type { TopicInput } from './pipeline/types.js';

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
  const checks: Record<string, unknown> = {
    sentryEnabled: Boolean(env.SENTRY_DSN),
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
  };

  // DB connectivity + per-brand summary. Each section degrades gracefully — a DB
  // outage flips status to 'degraded' but the endpoint still answers.
  let status: 'ok' | 'degraded' = 'ok';

  try {
    const dbHealth = await checkDbHealth();
    checks.db = dbHealth;
  } catch (err) {
    status = 'degraded';
    checks.db = { ok: false, error: err instanceof Error ? err.message : String(err) };
    captureException(err, { source: 'health-check-db' });
  }

  try {
    const brands = await listBrands();
    checks.brands = brands.map((b) => ({
      slug: b.slug,
      name: b.name,
      status: b.status,
    }));
    checks.brandCount = brands.length;
  } catch (err) {
    status = 'degraded';
    checks.brands = { error: err instanceof Error ? err.message : String(err) };
    captureException(err, { source: 'health-check-brands' });
  }

  res.writeHead(status === 'ok' ? 200 : 503, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status, ...checks }));
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

/**
 * Run the full pipeline (Strategist → Writer → Editor → Spanish → QG) for one topic.
 *
 * Body: {
 *   brand_slug: string,
 *   topic: { title: string, source_url: string, source_meta?: ... },
 *   mode?: 'extract_only'   // optional — keeps the Day 3 behavior for smoke tests
 * }
 *
 * Default response shape (full chain): RunChainResult — status, envelope (with
 * extraction, strategy, draft, grounding, telemetry), failure_category if any.
 */
async function handleRunPipeline(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  let body: { brand_slug?: string; topic?: TopicInput; mode?: 'extract_only' | 'full' };
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch (err) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_json', detail: (err as Error).message }));
    return;
  }

  if (!body.brand_slug || !body.topic?.title || !body.topic?.source_url) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      error: 'missing_fields',
      required: ['brand_slug', 'topic.title', 'topic.source_url'],
    }));
    return;
  }

  const brand = await getBrandBySlug(body.brand_slug);
  if (!brand) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'brand_not_found', slug: body.brand_slug }));
    return;
  }

  setBrandContext(brand.id, brand.slug);

  // Backward-compatible extract-only mode for smoke tests
  if (body.mode === 'extract_only') {
    const start = Date.now();
    const extraction = await extractClaims({ topic: body.topic, brand_slug: brand.slug });
    const elapsed_ms = Date.now() - start;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      mode: 'extract_only',
      brand: { id: brand.id, slug: brand.slug, name: brand.name },
      topic: body.topic,
      extraction,
      elapsed_ms,
    }, null, 2));
    return;
  }

  // Full chain
  const start = Date.now();
  const result = await runChain({ brand, topic: body.topic });
  const elapsed_ms = Date.now() - start;

  res.writeHead(result.ok ? 200 : 422, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    mode: 'full',
    brand: { id: brand.id, slug: brand.slug, name: brand.name },
    post_queue_id: result.post_queue_id,
    status: result.status,
    failure_category: result.failure_category,
    envelope: result.envelope,
    elapsed_ms,
  }, null, 2));
}

const routes: Route[] = [
  { method: 'GET', path: '/', handler: handleRoot },
  { method: 'GET', path: '/health', handler: handleHealth },
  { method: 'POST', path: '/throw', handler: handleThrow },
  { method: 'POST', path: '/run-pipeline', handler: handleRunPipeline },
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
