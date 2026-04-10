export interface JobSummaryRun {
  started_at: string;
  completed_at: string | null;
  status: string;
  kalshi_markets_fetched: number;
  kalshi_snapshots_written: number;
  resolutions_detected: number;
  error_types: string[];
}

export interface JobHealthSummary {
  latest_run: JobSummaryRun | null;
  last_12_runs: {
    total_runs: number;
    success_like_runs: number;
    failed_runs: number;
    total_errors: number;
    total_snapshots_written: number;
    total_resolutions_detected: number;
  };
}

export function summarizeJobHealth(runs: JobSummaryRun[]): JobHealthSummary {
  const latestRun = runs[0] ?? null;

  return {
    latest_run: latestRun,
    last_12_runs: {
      total_runs: runs.length,
      success_like_runs: runs.filter((run) => run.status === 'success' || run.status === 'partial').length,
      failed_runs: runs.filter((run) => run.status === 'failed').length,
      total_errors: runs.reduce((sum, run) => sum + run.error_types.length, 0),
      total_snapshots_written: runs.reduce((sum, run) => sum + run.kalshi_snapshots_written, 0),
      total_resolutions_detected: runs.reduce((sum, run) => sum + run.resolutions_detected, 0),
    },
  };
}
