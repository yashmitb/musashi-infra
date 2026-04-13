import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Module mocks (must be at the top, before any imports of the mocked modules) ---

vi.mock('../../src/api/kalshi-client.js', () => ({
  KalshiClient: vi.fn(),
}));

vi.mock('../../src/db/markets.js', () => ({
  listResolutionCandidates: vi.fn(),
}));

vi.mock('../../src/db/resolutions.js', () => ({
  insertResolution: vi.fn(),
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
  })),
}));

// --- Import after mocks ---

import { KalshiClient } from '../../src/api/kalshi-client.js';
import { failOpenRuns, startRun, completeRun } from '../../src/db/ingestion-log.js';
import { listResolutionCandidates } from '../../src/db/markets.js';
import { insertResolution } from '../../src/db/resolutions.js';
import { updateSourceHealth } from '../../src/db/source-health.js';
import { runResolutionCheck } from '../../src/jobs/resolution-check.js';

// Typed mock helpers
const mockFetchMarket = vi.fn();
const MockKalshiClient = vi.mocked(KalshiClient);
const mockListCandidates = vi.mocked(listResolutionCandidates);
const mockInsertResolution = vi.mocked(insertResolution);
const mockFailOpenRuns = vi.mocked(failOpenRuns);
const mockStartRun = vi.mocked(startRun);
const mockCompleteRun = vi.mocked(completeRun);
const mockUpdateSourceHealth = vi.mocked(updateSourceHealth);

// A minimal Kalshi market stub for a settled YES result
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

// A minimal candidate row
function makeCandidate(id = 'market-1', platformId = 'TEST-MARKET') {
  return { id, platform: 'kalshi' as const, platform_id: platformId, closes_at: '2026-01-01T00:00:00Z' };
}

describe('runResolutionCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Wire up KalshiClient mock constructor to return an object with fetchMarket
    MockKalshiClient.mockImplementation(() => ({ fetchMarket: mockFetchMarket }) as unknown as InstanceType<typeof KalshiClient>);
    mockFailOpenRuns.mockResolvedValue(undefined);
    mockStartRun.mockResolvedValue(undefined);
    mockCompleteRun.mockResolvedValue(undefined);
    mockUpdateSourceHealth.mockResolvedValue(undefined);
  });

  it('writes a YES resolution for a settled yes market', async () => {
    mockListCandidates.mockResolvedValue([makeCandidate()]);
    mockFetchMarket.mockResolvedValue(makeSettledMarket('yes'));
    mockInsertResolution.mockResolvedValue(true);

    const result = await runResolutionCheck();

    expect(result.status).toBe('success');
    expect(result.resolutions_detected).toBe(1);
    expect(result.kalshi_errors).toBe(0);
    expect(mockInsertResolution).toHaveBeenCalledWith(
      expect.objectContaining({ market_id: 'market-1', outcome: 'YES' }),
    );
  });

  it('writes a NO resolution for a settled no market', async () => {
    mockListCandidates.mockResolvedValue([makeCandidate()]);
    mockFetchMarket.mockResolvedValue(makeSettledMarket('no'));
    mockInsertResolution.mockResolvedValue(true);

    const result = await runResolutionCheck();

    expect(result.status).toBe('success');
    expect(result.resolutions_detected).toBe(1);
    expect(mockInsertResolution).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'NO' }),
    );
  });

  it('skips non-settled markets without writing a resolution', async () => {
    mockListCandidates.mockResolvedValue([makeCandidate()]);
    mockFetchMarket.mockResolvedValue({
      ...makeSettledMarket('yes'),
      status: 'open',
    });

    const result = await runResolutionCheck();

    expect(result.status).toBe('success');
    expect(result.resolutions_detected).toBe(0);
    expect(mockInsertResolution).not.toHaveBeenCalled();
  });

  it('skips a void/unexpected outcome without writing a resolution', async () => {
    mockListCandidates.mockResolvedValue([makeCandidate()]);
    // 'void' is not in the Kalshi type but can appear at runtime
    mockFetchMarket.mockResolvedValue({ ...makeSettledMarket('void') });

    const result = await runResolutionCheck();

    expect(result.status).toBe('success');
    expect(result.resolutions_detected).toBe(0);
    expect(mockInsertResolution).not.toHaveBeenCalled();
  });

  it('is idempotent: does not count a resolution if insertResolution returns false', async () => {
    mockListCandidates.mockResolvedValue([makeCandidate()]);
    mockFetchMarket.mockResolvedValue(makeSettledMarket('yes'));
    mockInsertResolution.mockResolvedValue(false); // already exists

    const result = await runResolutionCheck();

    expect(result.resolutions_detected).toBe(0);
    expect(result.status).toBe('success');
  });

  it('records per-market API errors and continues processing remaining markets', async () => {
    mockListCandidates.mockResolvedValue([
      makeCandidate('market-1', 'MARKET-1'),
      makeCandidate('market-2', 'MARKET-2'),
    ]);
    mockFetchMarket
      .mockRejectedValueOnce(new Error('connection timeout'))
      .mockResolvedValueOnce(makeSettledMarket('yes'));
    mockInsertResolution.mockResolvedValue(true);

    const result = await runResolutionCheck();

    // Partial because one market errored
    expect(result.status).toBe('partial');
    expect(result.kalshi_errors).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.error_type).toBe('resolution_check_market_failed');
    expect(result.errors[0]?.error_message).toContain('MARKET-1');

    // Second market still processed
    expect(result.resolutions_detected).toBe(1);
  });

  it('marks the whole job as failed if a fatal outer error occurs', async () => {
    mockListCandidates.mockRejectedValue(new Error('DB connection lost'));

    const result = await runResolutionCheck();

    expect(result.status).toBe('failed');
    expect(result.kalshi_available).toBe(false);
    expect(mockUpdateSourceHealth).toHaveBeenCalledWith(
      expect.objectContaining({ is_available: false }),
    );
  });

  it('skips non-kalshi candidates', async () => {
    mockListCandidates.mockResolvedValue([
      { id: 'poly-1', platform: 'polymarket' as unknown as 'kalshi', platform_id: 'POLY-1', closes_at: null },
    ]);

    const result = await runResolutionCheck();

    expect(result.kalshi_markets_fetched).toBe(0);
    expect(mockFetchMarket).not.toHaveBeenCalled();
  });

  it('skips a market when fetchMarket returns null (404)', async () => {
    mockListCandidates.mockResolvedValue([makeCandidate()]);
    mockFetchMarket.mockResolvedValue(null);

    const result = await runResolutionCheck();

    expect(result.status).toBe('success');
    expect(result.resolutions_detected).toBe(0);
    expect(mockInsertResolution).not.toHaveBeenCalled();
  });

  it('skips a settled market whose result is an empty string', async () => {
    mockListCandidates.mockResolvedValue([makeCandidate()]);
    mockFetchMarket.mockResolvedValue({ ...makeSettledMarket('yes'), result: '' });

    const result = await runResolutionCheck();

    expect(result.resolutions_detected).toBe(0);
    expect(mockInsertResolution).not.toHaveBeenCalled();
  });

  it('marks source health as available on a successful run', async () => {
    mockListCandidates.mockResolvedValue([makeCandidate()]);
    mockFetchMarket.mockResolvedValue(makeSettledMarket('yes'));
    mockInsertResolution.mockResolvedValue(true);

    await runResolutionCheck();

    expect(mockUpdateSourceHealth).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'kalshi', is_available: true }),
    );
  });

  it('always calls completeRun regardless of whether the job succeeds or fails', async () => {
    // Success path
    mockListCandidates.mockResolvedValue([]);
    await runResolutionCheck();
    expect(mockCompleteRun).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    MockKalshiClient.mockImplementation(() => ({ fetchMarket: mockFetchMarket }) as unknown as InstanceType<typeof KalshiClient>);
    mockFailOpenRuns.mockResolvedValue(undefined);
    mockStartRun.mockResolvedValue(undefined);
    mockCompleteRun.mockResolvedValue(undefined);
    mockUpdateSourceHealth.mockResolvedValue(undefined);

    // Failure path
    mockListCandidates.mockRejectedValue(new Error('DB down'));
    await runResolutionCheck();
    expect(mockCompleteRun).toHaveBeenCalledTimes(1);
  });
});
