import { randomUUID } from 'node:crypto';

import { KalshiClient } from '../api/kalshi-client.js';
import { failOpenRuns, startRun, completeRun, updateRunProgress } from '../db/ingestion-log.js';
import { listResolutionCandidates, markMarketSourceMissing, updateMarketLifecycle } from '../db/markets.js';
import { applyResolvedMarketState, insertResolutions } from '../db/resolutions.js';
import { updateSourceHealth } from '../db/source-health.js';
import { mapWithConcurrency } from '../lib/collections.js';
import { getEnv } from '../lib/env.js';
import type { MarketResolution } from '../types/storage.js';
import type { IngestionRunRecord } from '../types/storage.js';

export interface ResolutionCheckOptions {
  runType?: string;
  maxMarkets?: number;
  fetchConcurrency?: number;
  workerRateLimitMs?: number;
  progressEveryMarkets?: number;
}

export async function runResolutionCheck(options: ResolutionCheckOptions = {}): Promise<IngestionRunRecord> {
  const jobId = randomUUID();
  const startedAt = new Date();
  const env = getEnv();
  const runType = options.runType ?? 'resolution_check';
  const maxMarkets = options.maxMarkets ?? env.resolutionCheckMaxMarkets;
  const fetchConcurrency = options.fetchConcurrency ?? env.resolutionCheckFetchConcurrency;
  const workerRateLimitMs = options.workerRateLimitMs ?? env.resolutionCheckWorkerRateLimitMs;
  const progressEveryMarkets = options.progressEveryMarkets ?? env.resolutionCheckProgressEveryMarkets;

  await failOpenRuns(runType, `Superseded by a newer ${runType} run before completion.`);

  await startRun({
    job_id: jobId,
    run_type: runType,
    started_at: startedAt.toISOString(),
    status: 'running',
  });

  const result: IngestionRunRecord = {
    job_id: jobId,
    run_type: runType,
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

  try {
    const candidates = await listResolutionCandidates(startedAt, maxMarkets);
    const kalshiCandidates = candidates.filter((candidate) => candidate.platform === 'kalshi');
    const startedAtIso = startedAt.toISOString();
    let processed = 0;

    const processedCandidates = await mapWithConcurrency(
      kalshiCandidates,
      fetchConcurrency,
      async (candidate, _index) => {
        const client = new KalshiClient({
          baseUrl: env.kalshiBaseUrl,
          rateLimitMs: workerRateLimitMs,
        });

        try {
          const raw = await client.fetchMarket(candidate.platform_id);

          if (!raw) {
            return {
              candidate,
              resolution: null,
              lifecycleUpdate: null,
              sourceMissingAt: startedAtIso,
              sourceMissingFallbackSettlesAt: candidate.settles_at ?? candidate.closes_at,
              error: null,
            };
          }

          const lifecycleStatus = mapResolutionLifecycleStatus(raw.status);

          let outcome: 'YES' | 'NO' | null = null;
          if (lifecycleStatus === 'resolved' && raw.result) {
            const rawResult = raw.result.toLowerCase();
            if (rawResult === 'yes') {
              outcome = 'YES';
            } else if (rawResult === 'no') {
              outcome = 'NO';
            }
          }

          const resolution: MarketResolution | null =
            outcome !== null
              ? {
                  market_id: candidate.id,
                  outcome,
                  resolved_at: raw.latest_expiration_time ?? raw.close_time ?? startedAtIso,
                  final_yes_price: raw.last_price_dollars ? Number(raw.last_price_dollars) : null,
                  resolution_source: 'kalshi_api_v2',
                  detected_at: startedAtIso,
                }
              : null;

          const lifecycleUpdate =
            resolution === null
              ? {
                  marketId: candidate.id,
                  status: lifecycleStatus,
                  resolved: lifecycleStatus === 'resolved',
                  resolution: null,
                  resolved_at:
                    lifecycleStatus === 'resolved'
                      ? (raw.latest_expiration_time ?? raw.close_time ?? startedAtIso)
                      : null,
                  settles_at: raw.latest_expiration_time ?? raw.close_time ?? candidate.settles_at,
                  last_ingested_at: startedAtIso,
                }
              : null;

          processed += 1;

          if (processed % progressEveryMarkets === 0) {
            result.notes = `Resolution check in progress: processed ${processed}/${kalshiCandidates.length}, detected ${result.resolutions_detected}, errors ${result.kalshi_errors}.`;
            await updateRunProgress(jobId, {
              kalshi_markets_fetched: processed,
              resolutions_detected: result.resolutions_detected,
              kalshi_errors: result.kalshi_errors,
              errors: result.errors,
              status: 'running',
              notes: result.notes,
            });
          }

          return {
            candidate,
            resolution,
            lifecycleUpdate,
            sourceMissingAt: null,
            sourceMissingFallbackSettlesAt: null,
            error: null,
          };
        } catch (error) {
          processed += 1;
          result.kalshi_errors += 1;
          const runError = {
            source: 'kalshi' as const,
            error_type: 'resolution_check_market_failed',
            error_message: `${candidate.platform_id}: ${error instanceof Error ? error.message : String(error)}`,
            market_id: candidate.platform_id,
          };
          result.errors.push(runError);

          if (processed % progressEveryMarkets === 0) {
            result.notes = `Resolution check in progress: processed ${processed}/${kalshiCandidates.length}, detected ${result.resolutions_detected}, errors ${result.kalshi_errors}.`;
            await updateRunProgress(jobId, {
              kalshi_markets_fetched: processed,
              resolutions_detected: result.resolutions_detected,
              kalshi_errors: result.kalshi_errors,
              errors: result.errors,
              status: 'running',
              notes: result.notes,
            });
          }

          return {
            candidate,
            resolution: null,
            lifecycleUpdate: null,
            sourceMissingAt: null,
            sourceMissingFallbackSettlesAt: null,
            error: runError,
          };
        }
      }
    );

    result.kalshi_markets_fetched = kalshiCandidates.length;
    const pendingResolutions = processedCandidates.flatMap((item) => (item.resolution ? [item.resolution] : []));
    const lifecycleUpdates = processedCandidates.flatMap((item) =>
      item.lifecycleUpdate ? [item.lifecycleUpdate] : []
    );
    const sourceMissingUpdates = processedCandidates.flatMap((item) =>
      item.sourceMissingAt
        ? [
            {
              marketId: item.candidate.id,
              missingAt: item.sourceMissingAt,
              fallbackSettlesAt: item.sourceMissingFallbackSettlesAt,
            },
          ]
        : []
    );

    for (const lifecycleUpdate of lifecycleUpdates) {
      await updateMarketLifecycle(lifecycleUpdate.marketId, lifecycleUpdate);
    }
    for (const sourceMissingUpdate of sourceMissingUpdates) {
      await markMarketSourceMissing(
        sourceMissingUpdate.marketId,
        sourceMissingUpdate.missingAt,
        sourceMissingUpdate.fallbackSettlesAt
      );
    }
    const insertedCount = await insertResolutions(pendingResolutions);
    await applyResolvedMarketState(pendingResolutions);
    result.resolutions_detected = insertedCount;

    result.status = result.kalshi_errors > 0 ? 'partial' : 'success';
    result.notes =
      `Checked ${result.kalshi_markets_fetched} Kalshi markets and detected ${result.resolutions_detected} resolutions` +
      (result.kalshi_errors > 0 ? ` (${result.kalshi_errors} per-market errors).` : '.');
    await updateSourceHealth({
      source: 'kalshi',
      is_available: true,
      last_successful_fetch: new Date().toISOString(),
      last_error: null,
      last_error_at: null,
    });
  } catch (error) {
    result.kalshi_available = false;
    result.kalshi_errors += 1;
    result.status = 'failed';
    result.errors.push({
      source: 'kalshi',
      error_type: 'resolution_check_failed',
      error_message: error instanceof Error ? error.message : String(error),
    });
    await updateSourceHealth({
      source: 'kalshi',
      is_available: false,
      last_error: error instanceof Error ? error.message : String(error),
      last_error_at: new Date().toISOString(),
    });
  } finally {
    result.completed_at = new Date().toISOString();
    result.duration_ms = new Date(result.completed_at).getTime() - startedAt.getTime();
    await completeRun(result);
  }

  return result;
}

function mapResolutionLifecycleStatus(status: string): 'open' | 'closed' | 'resolved' {
  if (status === 'settled' || status === 'finalized') {
    return 'resolved';
  }

  if (status === 'closed') {
    return 'closed';
  }

  return 'open';
}
