import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Module mocks ---

vi.mock('../../src/api/kalshi-client.js', () => ({
  KalshiClient: vi.fn(),
}));

vi.mock('../../src/api/normalizer.js', () => ({
  normalizeKalshiMarket: vi.fn(),
}));

vi.mock('../../src/db/markets.js', () => ({
  listSnapshotGapCandidates: vi.fn(),
}));

vi.mock('../../src/db/snapshots.js', () => ({
  writeSnapshots: vi.fn(),
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
    gapDetectionMaxMarkets: 500,
    gapDetectionProgressEveryMarkets: 25,
  })),
}));

// --- Imports after mocks ---

import { KalshiClient } from '../../src/api/kalshi-client.js';
import { normalizeKalshiMarket } from '../../src/api/normalizer.js';
import { failOpenRuns, startRun, completeRun } from '../../src/db/ingestion-log.js';
import { listSnapshotGapCandidates } from '../../src/db/markets.js';
import { writeSnapshots } from '../../src/db/snapshots.js';
import { updateSourceHealth } from '../../src/db/source-health.js';
import { runGapDetection } from '../../src/jobs/gap-detection.js';

const mockFetchMarket = vi.fn();
const MockKalshiClient = vi.mocked(KalshiClient);
const mockListGapCandidates = vi.mocked(listSnapshotGapCandidates);
const mockNormalize = vi.mocked(normalizeKalshiMarket);
const mockWriteSnapshots = vi.mocked(writeSnapshots);
const mockFailOpenRuns = vi.mocked(failOpenRuns);
const mockStartRun = vi.mocked(startRun);
const mockCompleteRun = vi.mocked(completeRun);
const mockUpdateSourceHealth = vi.mocked(updateSourceHealth);

// A minimal raw Kalshi market
const RAW_MARKET = {
  ticker: 'TEST-MARKET',
  event_ticker: 'TEST',
  market_type: 'binary' as const,
  status: 'open' as const,
};

// A minimal normalised MusashiMarket stub
const NORMALISED_MARKET = {
  id: 'kalshi:TEST-MARKET',
  platform: 'kalshi' as const,
  platform_id: 'TEST-MARKET',
  fetched_at: new Date().toISOString(),
} as unknown as ReturnType<typeof normalizeKalshiMarket>['market'];

// A successful write result
const WRITE_RESULT = { kalshi_written: 1, polymarket_written: 0, total_written: 1 };
const EMPTY_WRITE_RESULT = { kalshi_written: 0, polymarket_written: 0, total_written: 0 };

function makeCandidate(id = 'market-1', lastSnapshotAt: string | null = null) {
  return { id, platform: 'kalshi' as const, platform_id: 'TEST-MARKET', last_snapshot_at: lastSnapshotAt };
}

describe('runGapDetection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockKalshiClient.mockImplementation(
      () => ({ fetchMarket: mockFetchMarket }) as unknown as InstanceType<typeof KalshiClient>,
    );
    mockFailOpenRuns.mockResolvedValue(undefined);
    mockStartRun.mockResolvedValue(undefined);
    mockCompleteRun.mockResolvedValue(undefined);
    mockUpdateSourceHealth.mockResolvedValue(undefined);
    mockNormalize.mockReturnValue({ market: NORMALISED_MARKET, platform_raw: {}, warnings: [] });
    mockWriteSnapshots.mockResolvedValue(WRITE_RESULT);
  });

  it('backfills a snapshot for a stale market (last_snapshot_at is old but within 24h)', async () => {
    const oneHourAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3h ago, beyond the 2h threshold
    mockListGapCandidates.mockResolvedValue([makeCandidate('market-1', oneHourAgo)]);
    mockFetchMarket.mockResolvedValue(RAW_MARKET);

    const result = await runGapDetection();

    expect(result.status).toBe('success');
    expect(result.kalshi_snapshots_written).toBe(1);
    expect(mockWriteSnapshots).toHaveBeenCalledWith(
      expect.arrayContaining([NORMALISED_MARKET]),
      expect.any(Date),
      { source: 'kalshi_api_v2' },
    );
  });

  it('backfills a snapshot for a market that has never been snapshotted (null)', async () => {
    mockListGapCandidates.mockResolvedValue([makeCandidate('market-1', null)]);
    mockFetchMarket.mockResolvedValue(RAW_MARKET);

    const result = await runGapDetection();

    expect(result.status).toBe('success');
    expect(result.kalshi_snapshots_written).toBe(1);
  });

  it('skips markets whose last_snapshot_at is older than 24h', async () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    mockListGapCandidates.mockResolvedValue([makeCandidate('market-1', twoDaysAgo)]);
    mockWriteSnapshots.mockResolvedValue(EMPTY_WRITE_RESULT);

    const result = await runGapDetection();

    expect(mockFetchMarket).not.toHaveBeenCalled();
    expect(result.kalshi_snapshots_written).toBe(0);
  });

  it('skips non-kalshi candidates', async () => {
    mockListGapCandidates.mockResolvedValue([
      { id: 'poly-1', platform: 'polymarket' as unknown as 'kalshi', platform_id: 'POLY-1', last_snapshot_at: null },
    ]);
    mockWriteSnapshots.mockResolvedValue(EMPTY_WRITE_RESULT);

    const result = await runGapDetection();

    expect(mockFetchMarket).not.toHaveBeenCalled();
    expect(result.kalshi_markets_fetched).toBe(0);
  });

  it('records a per-market error and continues backfilling remaining markets', async () => {
    mockListGapCandidates.mockResolvedValue([
      makeCandidate('market-1', null),
      makeCandidate('market-2', null),
    ]);
    mockFetchMarket
      .mockRejectedValueOnce(new Error('API timeout'))
      .mockResolvedValueOnce(RAW_MARKET);

    const result = await runGapDetection();

    expect(result.status).toBe('partial');
    expect(result.kalshi_errors).toBe(1);
    expect(result.errors[0]?.error_type).toBe('gap_detection_market_failed');

    // Second market was still fetched and snapshotted
    expect(mockWriteSnapshots).toHaveBeenCalledWith(
      expect.arrayContaining([NORMALISED_MARKET]),
      expect.any(Date),
      expect.anything(),
    );
  });

  it('marks the whole job as failed if a fatal outer error occurs', async () => {
    mockListGapCandidates.mockRejectedValue(new Error('DB is down'));

    const result = await runGapDetection();

    expect(result.status).toBe('failed');
    expect(result.kalshi_available).toBe(false);
    expect(mockUpdateSourceHealth).toHaveBeenCalledWith(
      expect.objectContaining({ is_available: false }),
    );
  });
});
