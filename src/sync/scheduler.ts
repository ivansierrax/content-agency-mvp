/**
 * Background scheduler — runs Notion brand-identity sync on a recurring interval.
 *
 * MVP design:
 *   - Single-replica only. Railway runs N=1 service for now. If we scale to N>1
 *     replicas, two replicas would race each other; Day 9 reliability work moves
 *     this to a Postgres advisory lock or pg_cron.
 *   - 5-min default interval with ±60s jitter so multiple service instances
 *     don't pile up at the top of the minute.
 *   - Skip-if-recent guard: any brand synced within the last 2 min is skipped
 *     this tick. Lets manual `/admin/refresh-brand/:slug` calls coexist without
 *     wasted work.
 *   - Per-brand error isolation lives inside `syncAllBrands` itself.
 */

import * as Sentry from '@sentry/node';
import { syncAllBrands } from './notion-brand.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const JITTER_MS = 60 * 1000; // ±60s

let timer: NodeJS.Timeout | null = null;
let stopped = false;

export interface StartSchedulerOptions {
  intervalMs?: number;
  /** Skip the immediate first run (useful in tests). Default false — run once on start. */
  skipImmediate?: boolean;
}

export function startScheduler(opts: StartSchedulerOptions = {}): void {
  if (timer) return; // already running — idempotent
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const results = await syncAllBrands();
      console.log(
        `[scheduler] notion_sync ran: ${results.length} brand(s)`,
        results.map((r) => ({ slug: r.brand_slug, counts: r.counts, warnings: r.warnings.length }))
      );
    } catch (err) {
      Sentry.captureException(err, { tags: { source: 'scheduler.tick' } });
      console.error('[scheduler] notion_sync error', err);
    } finally {
      if (!stopped) {
        const next = intervalMs + (Math.random() * 2 - 1) * JITTER_MS;
        timer = setTimeout(() => {
          void tick();
        }, next);
      }
    }
  };

  if (opts.skipImmediate) {
    timer = setTimeout(() => {
      void tick();
    }, intervalMs);
  } else {
    void tick();
  }
}

export function stopScheduler(): void {
  stopped = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
