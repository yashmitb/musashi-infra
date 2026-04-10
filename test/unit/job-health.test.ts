import { describe, expect, it } from 'vitest';

import { summarizeJobHealth } from '../../src/lib/job-health.js';

describe('summarizeJobHealth', () => {
  it('summarizes recent job runs', () => {
    const summary = summarizeJobHealth([
      {
        started_at: '2026-04-10T00:00:00Z',
        completed_at: '2026-04-10T00:01:00Z',
        status: 'partial',
        kalshi_markets_fetched: 100,
        kalshi_snapshots_written: 20,
        resolutions_detected: 5,
        error_types: ['candidate_failed'],
      },
      {
        started_at: '2026-04-09T23:00:00Z',
        completed_at: '2026-04-09T23:01:00Z',
        status: 'failed',
        kalshi_markets_fetched: 0,
        kalshi_snapshots_written: 0,
        resolutions_detected: 0,
        error_types: ['source_unavailable'],
      },
    ]);

    expect(summary.latest_run?.status).toBe('partial');
    expect(summary.last_12_runs.total_runs).toBe(2);
    expect(summary.last_12_runs.success_like_runs).toBe(1);
    expect(summary.last_12_runs.failed_runs).toBe(1);
    expect(summary.last_12_runs.total_errors).toBe(2);
    expect(summary.last_12_runs.total_snapshots_written).toBe(20);
    expect(summary.last_12_runs.total_resolutions_detected).toBe(5);
  });
});
