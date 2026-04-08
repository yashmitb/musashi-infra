import { getCheckpoint } from '../db/checkpoints.js';
import { getEnv } from '../lib/env.js';
import { runFullSync } from './full-sync.js';

const FULL_SYNC_CHECKPOINT_KEY = 'kalshi_full_sync';

export interface CrawlAdvanceSummary {
  started_at: string;
  completed_at: string;
  runs_attempted: number;
  runs_completed: number;
  total_markets_fetched_delta: number;
  total_markets_new_delta: number;
  total_snapshots_written_delta: number;
  stopped_reason: 'checkpoint_cleared' | 'max_runs_reached' | 'max_duration_reached' | 'run_failed';
  last_run_status: string | null;
  last_checkpoint_page_count: number | null;
  last_checkpoint_market_count: number | null;
}

export async function advanceCrawl(): Promise<CrawlAdvanceSummary> {
  const env = getEnv();
  const startedAt = new Date();
  const deadline = startedAt.getTime() + env.crawlAdvanceMaxDurationMs;

  let runsCompleted = 0;
  let totalMarketsFetchedDelta = 0;
  let totalMarketsNewDelta = 0;
  let totalSnapshotsWrittenDelta = 0;
  let lastRunStatus: string | null = null;
  let stoppedReason: CrawlAdvanceSummary['stopped_reason'] = 'max_runs_reached';

  for (let runIndex = 0; runIndex < env.crawlAdvanceMaxRuns; runIndex += 1) {
    if (Date.now() >= deadline) {
      stoppedReason = 'max_duration_reached';
      break;
    }

    const beforeCheckpoint = await getCheckpoint(FULL_SYNC_CHECKPOINT_KEY);
    const beforeMarketCount = beforeCheckpoint?.market_count ?? 0;

    const run = await runFullSync();
    runsCompleted += 1;
    lastRunStatus = run.status;

    const afterCheckpoint = await getCheckpoint(FULL_SYNC_CHECKPOINT_KEY);
    const afterMarketCount = afterCheckpoint?.market_count ?? 0;

    totalMarketsFetchedDelta += Math.max(0, afterMarketCount - beforeMarketCount);
    totalMarketsNewDelta += run.kalshi_markets_new;
    totalSnapshotsWrittenDelta += run.kalshi_snapshots_written;

    if (afterCheckpoint === null) {
      stoppedReason = 'checkpoint_cleared';
      break;
    }

    if (run.status === 'failed') {
      stoppedReason = 'run_failed';
      break;
    }

    if (Date.now() >= deadline) {
      stoppedReason = 'max_duration_reached';
      break;
    }

    if (runIndex === env.crawlAdvanceMaxRuns - 1) {
      stoppedReason = 'max_runs_reached';
    }
  }

  const finalCheckpoint = await getCheckpoint(FULL_SYNC_CHECKPOINT_KEY);

  return {
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    runs_attempted: env.crawlAdvanceMaxRuns,
    runs_completed: runsCompleted,
    total_markets_fetched_delta: totalMarketsFetchedDelta,
    total_markets_new_delta: totalMarketsNewDelta,
    total_snapshots_written_delta: totalSnapshotsWrittenDelta,
    stopped_reason: stoppedReason,
    last_run_status: lastRunStatus,
    last_checkpoint_page_count: finalCheckpoint?.page_count ?? null,
    last_checkpoint_market_count: finalCheckpoint?.market_count ?? null,
  };
}
