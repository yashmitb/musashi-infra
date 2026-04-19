import { randomUUID } from 'node:crypto';

import { KalshiClient } from '../api/kalshi-client.js';
import { failOpenRuns, startRun, completeRun } from '../db/ingestion-log.js';
import { listSettlesAtBackfillCandidates, markMarketSourceMissing, updateMarketSettlesAt } from '../db/markets.js';
import { getEnv } from '../lib/env.js';
import { mapWithConcurrency } from '../lib/collections.js';
import type { IngestionRunRecord } from '../types/storage.js';

export interface SettlesAtBackfillSummary {
  started_at: string;
  completed_at: string;
  runs_attempted: number;
  runs_completed: number;
  total_markets_checked: number;
  total_markets_updated: number;
  total_errors: number;
  stopped_reason: 'max_runs_reached' | 'max_duration_reached' | 'run_failed';
  last_run_status: string | null;
}

export interface RunSettlesAtBackfillOptions {
  runType?: string;
  maxMarkets?: number;
  fetchConcurrency?: number;
  workerRateLimitMs?: number;
}

export async function runSettlesAtBackfill(options: RunSettlesAtBackfillOptions = {}): Promise<IngestionRunRecord> {
  const jobId = randomUUID();
  const startedAt = new Date();
  const env = getEnv();
  const runType = options.runType ?? 'settles_at_backfill';
  const maxMarkets = options.maxMarkets ?? env.settlesAtBackfillMaxMarkets;
  const fetchConcurrency = options.fetchConcurrency ?? env.settlesAtBackfillFetchConcurrency;
  const workerRateLimitMs = options.workerRateLimitMs ?? env.settlesAtBackfillWorkerRateLimitMs;
  const startedAtIso = startedAt.toISOString();

  await failOpenRuns(runType, `Superseded by a newer ${runType} run before completion.`);

  await startRun({
    job_id: jobId,
    run_type: runType,
    started_at: startedAtIso,
    status: 'running',
  });

  const result: IngestionRunRecord = {
    job_id: jobId,
    run_type: runType,
    started_at: startedAtIso,
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

  try {
    const candidates = await listSettlesAtBackfillCandidates(startedAt, maxMarkets);

    const processed = await mapWithConcurrency(candidates, fetchConcurrency, async (candidate) => {
      const client = new KalshiClient({
        baseUrl: env.kalshiBaseUrl,
        rateLimitMs: workerRateLimitMs,
      });

      try {
        const raw = await client.fetchMarket(candidate.platform_id);
        if (!raw) {
          await markMarketSourceMissing(candidate.id, startedAtIso, candidate.closes_at);
          return { updated: false, error: null };
        }

        const settlesAt = raw?.latest_expiration_time ?? raw?.close_time ?? null;

        if (settlesAt === null) {
          return { updated: false, error: null };
        }

        await updateMarketSettlesAt(candidate.id, settlesAt, startedAtIso);
        return { updated: true, error: null };
      } catch (error) {
        return {
          updated: false,
          error: {
            source: 'kalshi',
            error_type: 'settles_at_backfill_market_failed',
            error_message: error instanceof Error ? error.message : String(error),
            market_id: candidate.id,
          },
        };
      }
    });

    let updatedCount = 0;

    for (const entry of processed) {
      result.kalshi_markets_fetched += 1;

      if (entry.updated) {
        updatedCount += 1;
        result.kalshi_markets_new += 1;
      }

      if (entry.error) {
        result.kalshi_errors += 1;
        result.errors.push(entry.error);
      }
    }

    result.status = result.kalshi_errors > 0 ? 'partial' : 'success';
    result.notes = `Checked ${result.kalshi_markets_fetched} Kalshi markets and updated ${updatedCount} settles_at values.`;
  } catch (error) {
    result.status = 'failed';
    result.kalshi_available = false;
    result.errors.push({
      source: 'kalshi',
      error_type: 'settles_at_backfill_failed',
      error_message: error instanceof Error ? error.message : String(error),
    });
    result.notes = 'settles_at backfill failed before completion.';
  }

  result.completed_at = new Date().toISOString();
  result.duration_ms = new Date(result.completed_at).getTime() - startedAt.getTime();

  await completeRun(result);

  return result;
}

export async function backfillSettlesAt(): Promise<SettlesAtBackfillSummary> {
  const env = getEnv();
  const startedAt = new Date();
  const deadline = startedAt.getTime() + env.settlesAtBackfillMaxDurationMs;

  let runsCompleted = 0;
  let totalMarketsChecked = 0;
  let totalMarketsUpdated = 0;
  let totalErrors = 0;
  let lastRunStatus: string | null = null;
  let stoppedReason: SettlesAtBackfillSummary['stopped_reason'] = 'max_runs_reached';

  for (let runIndex = 0; runIndex < env.settlesAtBackfillMaxRuns; runIndex += 1) {
    if (Date.now() >= deadline) {
      stoppedReason = 'max_duration_reached';
      break;
    }

    const run = await runSettlesAtBackfill({
      runType: 'settles_at_backfill',
      maxMarkets: env.settlesAtBackfillMaxMarkets,
      fetchConcurrency: env.settlesAtBackfillFetchConcurrency,
      workerRateLimitMs: env.settlesAtBackfillWorkerRateLimitMs,
    });

    runsCompleted += 1;
    lastRunStatus = run.status;
    totalMarketsChecked += run.kalshi_markets_fetched;
    totalMarketsUpdated += run.kalshi_markets_new;
    totalErrors += run.kalshi_errors;

    if (run.status === 'failed') {
      stoppedReason = 'run_failed';
      break;
    }

    if (run.kalshi_markets_new === 0 && run.kalshi_errors === 0) {
      stoppedReason = 'max_runs_reached';
      break;
    }

    if (Date.now() >= deadline) {
      stoppedReason = 'max_duration_reached';
      break;
    }

    if (runIndex === env.settlesAtBackfillMaxRuns - 1) {
      stoppedReason = 'max_runs_reached';
    }
  }

  return {
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    runs_attempted: env.settlesAtBackfillMaxRuns,
    runs_completed: runsCompleted,
    total_markets_checked: totalMarketsChecked,
    total_markets_updated: totalMarketsUpdated,
    total_errors: totalErrors,
    stopped_reason: stoppedReason,
    last_run_status: lastRunStatus,
  };
}
