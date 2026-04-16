import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/kalshi-client.js', () => ({
  KalshiClient: vi.fn(),
}));

vi.mock('../../src/db/markets.js', () => ({
  listSettlesAtBackfillCandidates: vi.fn(),
  updateMarketSettlesAt: vi.fn(),
}));

vi.mock('../../src/db/ingestion-log.js', () => ({
  failOpenRuns: vi.fn(),
  startRun: vi.fn(),
  completeRun: vi.fn(),
  updateRunProgress: vi.fn(),
}));

vi.mock('../../src/lib/env.js', () => ({
  getEnv: vi.fn(() => ({
    kalshiBaseUrl: 'https://test.kalshi.com',
    settlesAtBackfillMaxRuns: 3,
    settlesAtBackfillMaxDurationMs: 900000,
    settlesAtBackfillMaxMarkets: 400,
    settlesAtBackfillFetchConcurrency: 2,
    settlesAtBackfillWorkerRateLimitMs: 0,
  })),
}));

import { KalshiClient } from '../../src/api/kalshi-client.js';
import { completeRun, failOpenRuns, startRun } from '../../src/db/ingestion-log.js';
import { listSettlesAtBackfillCandidates, updateMarketSettlesAt } from '../../src/db/markets.js';
import { backfillSettlesAt, runSettlesAtBackfill } from '../../src/jobs/settles-at-backfill.js';

const mockFetchMarket = vi.fn();
const MockKalshiClient = vi.mocked(KalshiClient);
const mockListCandidates = vi.mocked(listSettlesAtBackfillCandidates);
const mockUpdateMarketSettlesAt = vi.mocked(updateMarketSettlesAt);
const mockFailOpenRuns = vi.mocked(failOpenRuns);
const mockStartRun = vi.mocked(startRun);
const mockCompleteRun = vi.mocked(completeRun);

function makeCandidate(id = 'market-1', platformId = 'TEST-MARKET') {
  return { id, platform_id: platformId, closes_at: '2026-01-01T00:00:00Z' };
}

describe('runSettlesAtBackfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockKalshiClient.mockImplementation(
      () => ({ fetchMarket: mockFetchMarket }) as unknown as InstanceType<typeof KalshiClient>
    );
    mockFailOpenRuns.mockResolvedValue(undefined);
    mockStartRun.mockResolvedValue(undefined);
    mockCompleteRun.mockResolvedValue(undefined);
    mockUpdateMarketSettlesAt.mockResolvedValue(undefined);
  });

  it('updates settles_at when Kalshi returns latest_expiration_time', async () => {
    mockListCandidates.mockResolvedValue([makeCandidate()]);
    mockFetchMarket.mockResolvedValue({
      latest_expiration_time: '2026-01-03T00:00:00Z',
      close_time: '2026-01-01T00:00:00Z',
    });

    const result = await runSettlesAtBackfill();

    expect(result.status).toBe('success');
    expect(result.kalshi_markets_fetched).toBe(1);
    expect(result.kalshi_markets_new).toBe(1);
    expect(mockUpdateMarketSettlesAt).toHaveBeenCalledWith('market-1', '2026-01-03T00:00:00Z', expect.any(String));
  });

  it('records a partial run when one market fetch fails', async () => {
    mockListCandidates.mockResolvedValue([makeCandidate('market-1', 'A'), makeCandidate('market-2', 'B')]);
    mockFetchMarket.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({
      latest_expiration_time: '2026-01-03T00:00:00Z',
    });

    const result = await runSettlesAtBackfill();

    expect(result.status).toBe('partial');
    expect(result.kalshi_errors).toBe(1);
    expect(result.kalshi_markets_new).toBe(1);
    expect(result.errors[0]?.error_type).toBe('settles_at_backfill_market_failed');
  });
});

describe('backfillSettlesAt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stops after a zero-update success run', async () => {
    mockListCandidates.mockResolvedValue([makeCandidate()]);
    MockKalshiClient.mockImplementation(
      () =>
        ({
          fetchMarket: vi.fn().mockResolvedValue({ latest_expiration_time: null, close_time: null }),
        }) as unknown as InstanceType<typeof KalshiClient>
    );
    mockFailOpenRuns.mockResolvedValue(undefined);
    mockStartRun.mockResolvedValue(undefined);
    mockCompleteRun.mockResolvedValue(undefined);

    const result = await backfillSettlesAt();

    expect(result.runs_completed).toBe(1);
    expect(result.total_markets_updated).toBe(0);
    expect(result.stopped_reason).toBe('max_runs_reached');
  });
});
