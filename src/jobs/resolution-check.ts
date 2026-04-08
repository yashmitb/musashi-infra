import { randomUUID } from 'node:crypto';

import { KalshiClient } from '../api/kalshi-client.js';
import { failOpenRuns, startRun, completeRun, updateRunProgress } from '../db/ingestion-log.js';
import { listResolutionCandidates } from '../db/markets.js';
import { insertResolution } from '../db/resolutions.js';
import { updateSourceHealth } from '../db/source-health.js';
import { getEnv } from '../lib/env.js';
import type { IngestionRunRecord } from '../types/storage.js';

export async function runResolutionCheck(): Promise<IngestionRunRecord> {
  const jobId = randomUUID();
  const startedAt = new Date();
  const env = getEnv();

  await failOpenRuns('resolution_check', 'Superseded by a newer resolution_check run before completion.');

  await startRun({
    job_id: jobId,
    run_type: 'resolution_check',
    started_at: startedAt.toISOString(),
    status: 'running',
  });

  const result: IngestionRunRecord = {
    job_id: jobId,
    run_type: 'resolution_check',
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
    const candidates = await listResolutionCandidates(startedAt, env.resolutionCheckMaxMarkets);

    let processed = 0;

    for (const candidate of candidates) {
      if (candidate.platform !== 'kalshi') {
        continue;
      }

      processed += 1;
      result.kalshi_markets_fetched += 1;
      const raw = await client.fetchMarket(candidate.platform_id);

      if (!raw || raw.status !== 'settled' || !raw.result) {
        continue;
      }

      const inserted = await insertResolution({
        market_id: candidate.id,
        outcome: raw.result === 'yes' ? 'YES' : 'NO',
        resolved_at: raw.latest_expiration_time ?? raw.close_time ?? startedAt.toISOString(),
        final_yes_price: raw.last_price_dollars ? Number(raw.last_price_dollars) : null,
        resolution_source: 'kalshi_api_v2',
        detected_at: startedAt.toISOString(),
      });

      if (inserted) {
        result.resolutions_detected += 1;
      }

      if (processed % env.resolutionCheckProgressEveryMarkets === 0) {
        result.notes = `Resolution check in progress: processed ${processed}/${candidates.length}, detected ${result.resolutions_detected}.`;
        await updateRunProgress(jobId, {
          kalshi_markets_fetched: result.kalshi_markets_fetched,
          resolutions_detected: result.resolutions_detected,
          kalshi_errors: result.kalshi_errors,
          status: 'running',
          notes: result.notes,
        });
      }
    }

    result.status = 'success';
    result.notes = `Checked ${result.kalshi_markets_fetched} Kalshi markets and detected ${result.resolutions_detected} resolutions.`;
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
      error_type: 'resolution_check_failed',
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
