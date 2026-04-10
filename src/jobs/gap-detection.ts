import { randomUUID } from 'node:crypto';

import { KalshiClient } from '../api/kalshi-client.js';
import { normalizeKalshiMarket } from '../api/normalizer.js';
import { failOpenRuns, startRun, completeRun, updateRunProgress } from '../db/ingestion-log.js';
import { listSnapshotGapCandidates } from '../db/markets.js';
import { writeSnapshots } from '../db/snapshots.js';
import { updateSourceHealth } from '../db/source-health.js';
import { getEnv } from '../lib/env.js';
import type { IngestionRunRecord } from '../types/storage.js';

export async function runGapDetection(): Promise<IngestionRunRecord> {
  const jobId = randomUUID();
  const startedAt = new Date();
  const env = getEnv();
  const threshold = new Date(startedAt.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const backfillWindow = new Date(startedAt.getTime() - 24 * 60 * 60 * 1000);

  await failOpenRuns('gap_detection', 'Superseded by a newer gap_detection run before completion.');

  await startRun({
    job_id: jobId,
    run_type: 'gap_detection',
    started_at: startedAt.toISOString(),
    status: 'running',
  });

  const result: IngestionRunRecord = {
    job_id: jobId,
    run_type: 'gap_detection',
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

  const client = new KalshiClient({ baseUrl: env.kalshiBaseUrl });

  try {
    const candidates = await listSnapshotGapCandidates(threshold, env.gapDetectionMaxMarkets);
    const marketsToBackfill = [];
    let processed = 0;

    for (const candidate of candidates) {
      if (candidate.platform !== 'kalshi') {
        continue;
      }

      if (candidate.last_snapshot_at !== null && new Date(candidate.last_snapshot_at) < backfillWindow) {
        continue;
      }

      try {
        const raw = await client.fetchMarket(candidate.platform_id);
        processed += 1;
        result.kalshi_markets_fetched += 1;

        if (!raw) {
          continue;
        }

        marketsToBackfill.push(normalizeKalshiMarket(raw, startedAt).market);
      } catch (error) {
        processed += 1;
        result.kalshi_errors += 1;
        result.errors.push({
          source: 'kalshi',
          error_type: 'gap_candidate_failed',
          error_message: error instanceof Error ? error.message : String(error),
          market_id: candidate.platform_id,
        });
      }

      if (processed % env.gapDetectionProgressEveryMarkets === 0) {
        result.notes = `Gap detection in progress: processed ${processed}/${candidates.length}, prepared ${marketsToBackfill.length} backfills, errors ${result.kalshi_errors}.`;
        await updateRunProgress(jobId, {
          kalshi_markets_fetched: result.kalshi_markets_fetched,
          kalshi_snapshots_written: result.kalshi_snapshots_written,
          kalshi_errors: result.kalshi_errors,
          errors: result.errors,
          status: 'running',
          notes: result.notes,
        });
      }
    }

    const snapshotResult = await writeSnapshots(marketsToBackfill, startedAt, {
      source: 'kalshi_api_v2',
    });

    result.kalshi_snapshots_written = snapshotResult.kalshi_written;
    result.status = result.kalshi_errors > 0 ? 'partial' : 'success';
    result.notes = `Detected ${candidates.length} gap candidates and backfilled ${snapshotResult.total_written} snapshots with ${result.kalshi_errors} errors.`;
    await updateSourceHealth({
      source: 'kalshi',
      is_available: true,
      market_count: result.kalshi_markets_fetched,
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
      error_type: 'gap_detection_failed',
      error_message: error instanceof Error ? error.message : String(error),
    });
    await updateSourceHealth({
      source: 'kalshi',
      is_available: false,
      market_count: result.kalshi_markets_fetched,
      last_error: error instanceof Error ? error.message : String(error),
      last_error_at: new Date().toISOString(),
    });
  }

  result.completed_at = new Date().toISOString();
  result.duration_ms = new Date(result.completed_at).getTime() - startedAt.getTime();
  await completeRun(result);
  return result;
}
