import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/kalshi-client.js', () => ({
  KalshiClient: vi.fn(),
}));

vi.mock('../../src/db/markets.js', () => ({
  listResolutionCandidates: vi.fn(),
  updateMarketLifecycle: vi.fn(),
}));

vi.mock('../../src/db/resolutions.js', () => ({
  insertResolutions: vi.fn(),
  applyResolvedMarketState: vi.fn(),
}));

vi.mock('../../src/db/ingestion-log.js', () => ({
  failOpenRuns: vi.fn(),
  startRun: vi.fn(),
  completeRun: vi.fn(),
  updateRunProgress: vi.fn(),
}));

vi.mock('../../src/db/source-health.js', () => ({
  updateSourceHealth: vi.fn(),
}));

vi.mock('../../src/lib/env.js', () => ({
  getEnv: vi.fn(() => ({
    kalshiBaseUrl: 'https://test.kalshi.com',
    resolutionCheckMaxMarkets: 500,
    resolutionCheckProgressEveryMarkets: 25,
    resolutionCheckFetchConcurrency: 1,
    resolutionCheckWorkerRateLimitMs: 0,
  })),
}));

import { KalshiClient } from '../../src/api/kalshi-client.js';
import { completeRun, failOpenRuns, startRun } from '../../src/db/ingestion-log.js';
import { listResolutionCandidates, updateMarketLifecycle } from '../../src/db/markets.js';
import { applyResolvedMarketState, insertResolutions } from '../../src/db/resolutions.js';
import { updateSourceHealth } from '../../src/db/source-health.js';
import { runResolutionCheck } from '../../src/jobs/resolution-check.js';

const mockFetchMarket = vi.fn();
const MockKalshiClient = vi.mocked(KalshiClient);
const mockListCandidates = vi.mocked(listResolutionCandidates);
const mockUpdateMarketLifecycle = vi.mocked(updateMarketLifecycle);
const mockInsertResolutions = vi.mocked(insertResolutions);
const mockApplyResolvedMarketState = vi.mocked(applyResolvedMarketState);
const mockFailOpenRuns = vi.mocked(failOpenRuns);
const mockStartRun = vi.mocked(startRun);
const mockCompleteRun = vi.mocked(completeRun);
const mockUpdateSourceHealth = vi.mocked(updateSourceHealth);

function makeSettledMarket(result: string = 'yes') {
  return {
    ticker: 'TEST-MARKET',
    event_ticker: 'TEST',
    market_type: 'binary' as const,
    status: 'settled' as const,
    result,
    close_time: '2026-01-01T00:00:00Z',
    latest_expiration_time: '2026-01-01T00:00:00Z',
    last_price_dollars: '0.72',
  };
}

function makeCandidate(id = 'market-1', platformId = 'TEST-MARKET') {
  return {
    id,
    platform: 'kalshi' as const,
    platform_id: platformId,
    closes_at: '2026-01-01T00:00:00Z',
    settles_at: '2026-01-01T00:00:00Z',
  };
}

describe('runResolutionCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockKalshiClient.mockImplementation(
      () => ({ fetchMarket: mockFetchMarket }) as unknown as InstanceType<typeof KalshiClient>
    );
    mockFailOpenRuns.mockResolvedValue(undefined);
    mockStartRun.mockResolvedValue(undefined);
    mockCompleteRun.mockResolvedValue(undefined);
    mockUpdateSourceHealth.mockResolvedValue(undefined);
    mockUpdateMarketLifecycle.mockResolvedValue(undefined);
    mockInsertResolutions.mockResolvedValue(0);
    mockApplyResolvedMarketState.mockResolvedValue(undefined);
  });

  it('writes a yes resolution for a settled yes market', async () => {
    mockListCandidates.mockResolvedValue([makeCandidate()]);
    mockFetchMarket.mockResolvedValue(makeSettledMarket('yes'));
    mockInsertResolutions.mockResolvedValue(1);

    const result = await runResolutionCheck();

    expect(result.status).toBe('success');
    expect(result.resolutions_detected).toBe(1);
    expect(mockInsertResolutions).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ market_id: 'market-1', outcome: 'YES' })])
    );
  });

  it('marks unsupported resolved outcomes terminal without inserting a resolution', async () => {
    mockListCandidates.mockResolvedValue([makeCandidate()]);
    mockFetchMarket.mockResolvedValue({ ...makeSettledMarket('void') });

    const result = await runResolutionCheck();

    expect(result.status).toBe('success');
    expect(result.resolutions_detected).toBe(0);
    expect(mockInsertResolutions).toHaveBeenCalledWith([]);
    expect(mockUpdateMarketLifecycle).toHaveBeenCalledWith(
      'market-1',
      expect.objectContaining({
        status: 'resolved',
        resolved: true,
        resolution: null,
      })
    );
  });

  it('records a per-market error and continues processing remaining markets', async () => {
    mockListCandidates.mockResolvedValue([
      makeCandidate('market-1', 'MARKET-1'),
      makeCandidate('market-2', 'MARKET-2'),
    ]);
    mockFetchMarket
      .mockRejectedValueOnce(new Error('connection timeout'))
      .mockResolvedValueOnce(makeSettledMarket('yes'));
    mockInsertResolutions.mockResolvedValue(1);

    const result = await runResolutionCheck();

    expect(result.status).toBe('partial');
    expect(result.kalshi_errors).toBe(1);
    expect(result.errors[0]?.error_type).toBe('resolution_check_market_failed');
    expect(result.errors[0]?.error_message).toContain('MARKET-1');
    expect(result.resolutions_detected).toBe(1);
  });

  it('always completes the run record on fatal failure', async () => {
    mockListCandidates.mockRejectedValue(new Error('DB down'));

    const result = await runResolutionCheck();

    expect(result.status).toBe('failed');
    expect(mockCompleteRun).toHaveBeenCalledTimes(1);
  });
});
