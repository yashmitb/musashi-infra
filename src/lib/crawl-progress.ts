export interface CrawlCheckpointSummary {
  updated_at: string;
  market_count: number;
  page_count: number;
}

export interface CrawlRunSummary {
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  kalshi_markets_new: number;
  kalshi_snapshots_written: number;
  status: string;
  error_types: string[];
}

export interface CrawlProgressInput {
  checkpoint: CrawlCheckpointSummary | null;
  recentRuns: CrawlRunSummary[];
}

export interface CrawlThroughputSummary {
  completed_runs: number;
  total_markets_new: number;
  total_snapshots_written: number;
  total_duration_minutes: number;
  avg_markets_per_minute: number | null;
  avg_snapshots_per_minute: number | null;
  avg_markets_per_run: number | null;
}

export interface CrawlProgressResult {
  coverage: {
    checkpoint_page_count: number | null;
    checkpoint_market_count: number | null;
    checkpoint_updated_at: string | null;
  };
  latest_run: {
    started_at: string;
    completed_at: string | null;
    status: string;
    error_types: string[];
  } | null;
  throughput: CrawlThroughputSummary;
}

export function summarizeCrawlProgress(input: CrawlProgressInput): CrawlProgressResult {
  const completedRuns = input.recentRuns.filter(
    (run) =>
      run.completed_at !== null &&
      run.duration_ms !== null &&
      run.duration_ms > 0 &&
      run.status !== 'failed' &&
      run.error_types.every((errorType) => errorType === 'page_budget_exhausted')
  );

  const totalDurationMs = completedRuns.reduce((sum, run) => sum + (run.duration_ms ?? 0), 0);
  const totalMarketsNew = completedRuns.reduce((sum, run) => sum + run.kalshi_markets_new, 0);
  const totalSnapshotsWritten = completedRuns.reduce((sum, run) => sum + run.kalshi_snapshots_written, 0);
  const totalDurationMinutes = round(totalDurationMs / 60000);

  return {
    coverage: {
      checkpoint_page_count: input.checkpoint?.page_count ?? null,
      checkpoint_market_count: input.checkpoint?.market_count ?? null,
      checkpoint_updated_at: input.checkpoint?.updated_at ?? null,
    },
    latest_run: input.recentRuns[0]
      ? {
          started_at: input.recentRuns[0].started_at,
          completed_at: input.recentRuns[0].completed_at,
          status: input.recentRuns[0].status,
          error_types: input.recentRuns[0].error_types,
        }
      : null,
    throughput: {
      completed_runs: completedRuns.length,
      total_markets_new: totalMarketsNew,
      total_snapshots_written: totalSnapshotsWritten,
      total_duration_minutes: totalDurationMinutes,
      avg_markets_per_minute: totalDurationMinutes > 0 ? round(totalMarketsNew / totalDurationMinutes) : null,
      avg_snapshots_per_minute: totalDurationMinutes > 0 ? round(totalSnapshotsWritten / totalDurationMinutes) : null,
      avg_markets_per_run: completedRuns.length > 0 ? round(totalMarketsNew / completedRuns.length) : null,
    },
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
