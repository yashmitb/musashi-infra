import { describe, expect, it } from 'vitest';

import { selectSnapshotCandidates } from '../../src/lib/snapshot-policy.js';
import type { MusashiMarket } from '../../src/types/market.js';

function buildMarket(overrides: Partial<MusashiMarket> = {}): MusashiMarket {
  return {
    id: 'musashi-kalshi-test',
    platform: 'kalshi',
    platform_id: 'TEST',
    event_id: 'EVENT',
    series_id: 'SERIES',
    title: 'Test market',
    description: null,
    category: 'other',
    url: 'https://kalshi.com/markets/event/test',
    yes_price: 0.5,
    no_price: 0.5,
    volume_24h: 0,
    open_interest: null,
    liquidity: null,
    spread: 0.02,
    status: 'open',
    created_at: '2026-04-10T00:00:00Z',
    closes_at: '2026-04-10T12:00:00Z',
    settles_at: '2026-04-10T12:00:00Z',
    resolved: false,
    resolution: null,
    resolved_at: null,
    fetched_at: '2026-04-10T00:00:00Z',
    cache_hit: false,
    data_age_seconds: 0,
    ...overrides,
  };
}

describe('selectSnapshotCandidates', () => {
  it('keeps markets closing soon even with low activity', () => {
    const result = selectSnapshotCandidates([buildMarket()], new Date('2026-04-10T00:00:00Z'), {
      limit: 10,
      activeWindowHours: 24,
      minVolume24h: 1000,
      minLiquidity: 1000,
    });

    expect(result).toHaveLength(1);
  });

  it('keeps active markets even when they do not close soon', () => {
    const result = selectSnapshotCandidates(
      [
        buildMarket({
          id: 'active',
          closes_at: '2026-04-12T00:00:00Z',
          volume_24h: 2500,
        }),
      ],
      new Date('2026-04-10T00:00:00Z'),
      {
        limit: 10,
        activeWindowHours: 24,
        minVolume24h: 1000,
        minLiquidity: 1000,
      }
    );

    expect(result.map((market) => market.id)).toEqual(['active']);
  });

  it('filters out inactive markets outside the active window', () => {
    const result = selectSnapshotCandidates(
      [
        buildMarket({
          id: 'inactive',
          closes_at: '2026-04-12T00:00:00Z',
          volume_24h: 10,
          liquidity: 20,
        }),
      ],
      new Date('2026-04-10T00:00:00Z'),
      {
        limit: 10,
        activeWindowHours: 24,
        minVolume24h: 1000,
        minLiquidity: 1000,
      }
    );

    expect(result).toEqual([]);
  });

  it('respects the limit after prioritizing closer markets', () => {
    const result = selectSnapshotCandidates(
      [
        buildMarket({ id: 'later', closes_at: '2026-04-10T23:00:00Z' }),
        buildMarket({ id: 'sooner', closes_at: '2026-04-10T02:00:00Z' }),
      ],
      new Date('2026-04-10T00:00:00Z'),
      {
        limit: 1,
        activeWindowHours: 24,
        minVolume24h: 1000,
        minLiquidity: 1000,
      }
    );

    expect(result.map((market) => market.id)).toEqual(['sooner']);
  });
});
