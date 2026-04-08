import { randomUUID } from 'node:crypto';

import {
  KalshiClient,
  KalshiPaginationBudgetError,
  KalshiPaginationCursorError,
} from '../api/kalshi-client.js';
import { normalizeKalshiBatch } from '../api/normalizer.js';
import { getEnv } from '../lib/env.js';
import { getCheckpoint, upsertCheckpoint, clearCheckpoint } from '../db/checkpoints.js';
import { failOpenRuns, startRun, completeRun, updateRunProgress } from '../db/ingestion-log.js';
import { upsertMarkets } from '../db/markets.js';
import { writeSnapshots } from '../db/snapshots.js';
import { updateSourceHealth } from '../db/source-health.js';
import type { IngestionRunRecord } from '../types/storage.js';

const FULL_SYNC_CHECKPOINT_KEY = 'kalshi_full_sync';

export async function runFullSync(): Promise<IngestionRunRecord> {
  const jobId = randomUUID();
  const startedAt = new Date();
  const env = getEnv();
  const checkpoint = await getCheckpoint(FULL_SYNC_CHECKPOINT_KEY);
  const snapshotTime = checkpoint?.snapshot_time ? new Date(checkpoint.snapshot_time) : startedAt;

  await failOpenRuns('full_sync', 'Superseded by a newer full_sync run before completion.');

  await startRun({
    job_id: jobId,
    run_type: 'full_sync',
    started_at: startedAt.toISOString(),
    status: 'running',
  });

  const result: IngestionRunRecord = {
    job_id: jobId,
    run_type: 'full_sync',
    started_at: startedAt.toISOString(),
    completed_at: null,
    duration_ms: null,
    kalshi_markets_fetched: 0,
    kalshi_markets_new: 0,
    kalshi_snapshots_written: 0,
    kalshi_errors: 0,
    kalshi_available: true,
    kalshi_fetch_ms: null,
    polymarket_markets_fetched: 0,
    polymarket_markets_new: 0,
    polymarket_snapshots_written: 0,
    polymarket_errors: 0,
    polymarket_available: false,
    polymarket_fetch_ms: null,
    resolutions_detected: 0,
    errors: [],
    status: 'running',
    notes: null,
  };

  const client = new KalshiClient({
    baseUrl: env.kalshiBaseUrl,
  });

  try {
    let pageIndex = checkpoint?.page_count ?? 0;
    let nextCursor = checkpoint?.cursor ?? '';
    result.kalshi_markets_fetched = checkpoint?.market_count ?? 0;

    const remainingAbsolutePages = Math.max(0, env.fullSyncAbsoluteMaxPages - pageIndex);
    const runPageBudget = Math.min(env.fullSyncPageBudget, remainingAbsolutePages);

    if (runPageBudget <= 0) {
      throw new KalshiPaginationBudgetError(
        `Kalshi crawl reached the configured absolute page cap of ${env.fullSyncAbsoluteMaxPages}`,
      );
    }

    for await (const page of client.iterateMarkets({
      cursor: nextCursor,
      limit: env.fullSyncPageSize,
      status: 'open',
      maxPages: runPageBudget,
    })) {
      pageIndex += 1;
      const fetchedAt = new Date();
      result.kalshi_fetch_ms = (result.kalshi_fetch_ms ?? 0) + page.fetch_ms;
      result.kalshi_markets_fetched += page.markets.length;

      const normalizedBatch = normalizeKalshiBatch(page.markets, fetchedAt);
      result.kalshi_errors += normalizedBatch.errors.length;

      for (const error of normalizedBatch.errors) {
        result.errors.push({
          source: 'kalshi',
          error_type: 'normalize_failed',
          error_message: error.error,
          market_id: error.platform_id,
        });
      }

      const upsertResult = await upsertMarkets(normalizedBatch.normalized);
      result.kalshi_markets_new += upsertResult.kalshi_new;

      const snapshotResult = await writeSnapshots(
        normalizedBatch.normalized.map(({ market }) => market),
        snapshotTime,
        {
          source: 'kalshi_api_v2',
          fetchLatencyMs: page.fetch_ms,
        },
      );
      result.kalshi_snapshots_written += snapshotResult.kalshi_written;

      nextCursor = page.cursor;

      await upsertCheckpoint({
        checkpoint_key: FULL_SYNC_CHECKPOINT_KEY,
        run_type: 'full_sync',
        cursor: nextCursor === '' ? null : nextCursor,
        page_count: pageIndex,
        market_count: result.kalshi_markets_fetched,
        snapshot_time: snapshotTime.toISOString(),
        job_id: jobId,
      });

      if (pageIndex % env.fullSyncProgressEveryPages === 0 || nextCursor === '') {
        result.notes = formatProgressNote({
          resumed: checkpoint !== null,
          pageIndex,
          marketCount: result.kalshi_markets_fetched,
          snapshotsWritten: result.kalshi_snapshots_written,
          nextCursor,
        });
        await updateRunProgress(jobId, {
          kalshi_markets_fetched: result.kalshi_markets_fetched,
          kalshi_markets_new: result.kalshi_markets_new,
          kalshi_snapshots_written: result.kalshi_snapshots_written,
          kalshi_errors: result.kalshi_errors,
          kalshi_fetch_ms: result.kalshi_fetch_ms,
          errors: result.errors,
          status: 'running',
          notes: result.notes,
        });
      }
    }

    await updateSourceHealth({
      source: 'kalshi',
      is_available: true,
      market_count: result.kalshi_markets_fetched,
      last_successful_fetch: new Date().toISOString(),
      last_error: null,
      last_error_at: null,
    });

    await clearCheckpoint(FULL_SYNC_CHECKPOINT_KEY);
    result.status = result.errors.length > 0 ? 'partial' : 'success';
    result.notes = `Processed ${result.kalshi_markets_fetched} Kalshi markets across ${checkpoint?.page_count ? 'a resumed' : 'a fresh'} full sync and wrote ${result.kalshi_snapshots_written} snapshots.`;
  } catch (error) {
    const errorType = classifyFullSyncError(error);
    result.kalshi_available = errorType === 'source_unavailable' ? false : true;
    result.status = result.kalshi_markets_fetched > 0 ? 'partial' : 'failed';
    result.errors.push({
      source: 'kalshi',
      error_type: errorType,
      error_message: error instanceof Error ? error.message : String(error),
    });
    result.kalshi_errors += 1;

    await updateSourceHealth({
      source: 'kalshi',
      is_available: result.kalshi_available,
      market_count: result.kalshi_markets_fetched,
      last_error: errorType === 'source_unavailable' ? (error instanceof Error ? error.message : String(error)) : null,
      last_error_at: errorType === 'source_unavailable' ? new Date().toISOString() : null,
      last_successful_fetch: result.kalshi_available ? new Date().toISOString() : null,
    });

    result.notes =
      errorType === 'page_budget_exhausted'
        ? `Full sync paused after ${result.kalshi_markets_fetched} markets. Resume checkpoint retained.`
        : `Full sync stopped after ${result.kalshi_markets_fetched} markets. Resume checkpoint retained.`;
  }

  result.completed_at = new Date().toISOString();
  result.duration_ms = new Date(result.completed_at).getTime() - startedAt.getTime();

  await completeRun(result);
  return result;
}

function classifyFullSyncError(error: unknown): string {
  if (error instanceof KalshiPaginationBudgetError) {
    return 'page_budget_exhausted';
  }

  if (error instanceof KalshiPaginationCursorError) {
    return 'cursor_loop_detected';
  }

  return 'source_unavailable';
}

function formatProgressNote(input: {
  resumed: boolean;
  pageIndex: number;
  marketCount: number;
  snapshotsWritten: number;
  nextCursor: string;
}): string {
  const prefix = input.resumed ? 'Resuming full sync' : 'Running full sync';
  const cursorState = input.nextCursor === '' ? 'complete' : 'checkpoint saved';

  return `${prefix}: page ${input.pageIndex}, markets ${input.marketCount}, snapshots ${input.snapshotsWritten}, ${cursorState}.`;
}
