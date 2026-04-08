import { describe, expect, it } from 'vitest';

import { summarizeCrawlProgress } from '../../src/lib/crawl-progress.js';

describe('summarizeCrawlProgress', () => {
  it('summarizes bounded crawl throughput from recent completed runs', () => {
    const result = summarizeCrawlProgress({
      checkpoint: {
        updated_at: '2026-04-08T12:00:00.000Z',
        market_count: 9000,
        page_count: 9,
      },
      recentRuns: [
        {
          started_at: '2026-04-08T11:50:00.000Z',
          completed_at: '2026-04-08T11:56:00.000Z',
          duration_ms: 360000,
          kalshi_markets_new: 1000,
          kalshi_snapshots_written: 1000,
          status: 'partial',
          error_types: ['page_budget_exhausted'],
        },
        {
          started_at: '2026-04-08T11:40:00.000Z',
          completed_at: '2026-04-08T11:46:00.000Z',
          duration_ms: 360000,
          kalshi_markets_new: 1000,
          kalshi_snapshots_written: 1000,
          status: 'partial',
          error_types: ['page_budget_exhausted'],
        },
      ],
    });

    expect(result.coverage.checkpoint_page_count).toBe(9);
    expect(result.throughput.completed_runs).toBe(2);
    expect(result.throughput.total_markets_new).toBe(2000);
    expect(result.throughput.total_duration_minutes).toBe(12);
    expect(result.throughput.avg_markets_per_minute).toBe(166.67);
    expect(result.throughput.avg_markets_per_run).toBe(1000);
  });

  it('ignores failed and non-budget runs in throughput metrics', () => {
    const result = summarizeCrawlProgress({
      checkpoint: null,
      recentRuns: [
        {
          started_at: '2026-04-08T11:50:00.000Z',
          completed_at: '2026-04-08T11:56:00.000Z',
          duration_ms: 360000,
          kalshi_markets_new: 1000,
          kalshi_snapshots_written: 1000,
          status: 'failed',
          error_types: ['source_unavailable'],
        },
        {
          started_at: '2026-04-08T11:40:00.000Z',
          completed_at: '2026-04-08T11:46:00.000Z',
          duration_ms: 360000,
          kalshi_markets_new: 1000,
          kalshi_snapshots_written: 1000,
          status: 'partial',
          error_types: ['cursor_loop_detected'],
        },
      ],
    });

    expect(result.throughput.completed_runs).toBe(0);
    expect(result.throughput.avg_markets_per_minute).toBeNull();
    expect(result.latest_run?.status).toBe('failed');
  });
});
