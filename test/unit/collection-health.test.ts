import { describe, expect, it } from 'vitest';

import { evaluateCollectionHealth } from '../../src/lib/collection-health.js';

describe('evaluateCollectionHealth', () => {
  const now = new Date('2026-04-08T12:00:00.000Z');

  it('treats a fresh bounded run as healthy', () => {
    const result = evaluateCollectionHealth({
      now,
      checkpoint: {
        updated_at: '2026-04-08T11:50:00.000Z',
        market_count: 9000,
        page_count: 9,
      },
      latestRun: {
        started_at: '2026-04-08T11:45:00.000Z',
        completed_at: '2026-04-08T11:50:00.000Z',
        status: 'partial',
        error_types: ['page_budget_exhausted'],
      },
      sourceHealth: {
        is_available: true,
        last_successful_fetch: '2026-04-08T11:50:00.000Z',
        last_error: null,
      },
      stallMaxMinutes: 180,
      runMaxAgeMinutes: 30,
    });

    expect(result.healthy).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('flags a stale checkpoint', () => {
    const result = evaluateCollectionHealth({
      now,
      checkpoint: {
        updated_at: '2026-04-08T07:00:00.000Z',
        market_count: 9000,
        page_count: 9,
      },
      latestRun: {
        started_at: '2026-04-08T08:00:00.000Z',
        completed_at: '2026-04-08T08:05:00.000Z',
        status: 'partial',
        error_types: ['page_budget_exhausted'],
      },
      sourceHealth: {
        is_available: true,
        last_successful_fetch: '2026-04-08T08:05:00.000Z',
        last_error: null,
      },
      stallMaxMinutes: 180,
      runMaxAgeMinutes: 30,
    });

    expect(result.healthy).toBe(false);
    expect(result.reasons[0]).toContain('Checkpoint stale');
  });

  it('accepts a stale checkpoint when bounded runs and source fetches are still fresh', () => {
    const result = evaluateCollectionHealth({
      now,
      checkpoint: {
        updated_at: '2026-04-08T07:00:00.000Z',
        market_count: 9000,
        page_count: 1000,
      },
      latestRun: {
        started_at: '2026-04-08T11:45:00.000Z',
        completed_at: '2026-04-08T11:50:00.000Z',
        status: 'partial',
        error_types: ['page_budget_exhausted'],
      },
      sourceHealth: {
        is_available: true,
        last_successful_fetch: '2026-04-08T11:55:00.000Z',
        last_error: null,
      },
      stallMaxMinutes: 180,
      runMaxAgeMinutes: 30,
    });

    expect(result.healthy).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('flags non-budget errors on the latest run', () => {
    const result = evaluateCollectionHealth({
      now,
      checkpoint: {
        updated_at: '2026-04-08T11:50:00.000Z',
        market_count: 9000,
        page_count: 9,
      },
      latestRun: {
        started_at: '2026-04-08T11:45:00.000Z',
        completed_at: '2026-04-08T11:50:00.000Z',
        status: 'partial',
        error_types: ['source_unavailable'],
      },
      sourceHealth: {
        is_available: true,
        last_successful_fetch: '2026-04-08T11:50:00.000Z',
        last_error: null,
      },
      stallMaxMinutes: 180,
      runMaxAgeMinutes: 30,
    });

    expect(result.healthy).toBe(false);
    expect(result.reasons.join(' ')).toContain('non-budget errors');
  });

  it('accepts a missing checkpoint when the latest full sync completed cleanly', () => {
    const result = evaluateCollectionHealth({
      now,
      checkpoint: null,
      latestRun: {
        started_at: '2026-04-08T11:45:00.000Z',
        completed_at: '2026-04-08T11:50:00.000Z',
        status: 'success',
        error_types: [],
      },
      sourceHealth: {
        is_available: true,
        last_successful_fetch: '2026-04-08T11:50:00.000Z',
        last_error: null,
      },
      stallMaxMinutes: 180,
      runMaxAgeMinutes: 30,
    });

    expect(result.healthy).toBe(true);
    expect(result.reasons).toEqual([]);
  });
});
