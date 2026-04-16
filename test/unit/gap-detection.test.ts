import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { KalshiClient } from '../../src/api/kalshi-client.js';
import { normalizeKalshiMarket } from '../../src/api/normalizer.js';
import { completeRun, failOpenRuns, startRun } from '../../src/db/ingestion-log.js';
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

const RAW_MARKET = {
  ticker: 'TEST-MARKET',
  event_ticker: 'TEST',
  market_type: 'binary' as const,
  status: 'open' as const,
};

const NORMALISED_MARKET = {
  id: 'kalshi:TEST-MARKET',
  platform: 'kalshi' as const,
  platform_id: 'TEST-MARKET',
  fetched_at: new Date().toISOString(),
} as unknown as ReturnType<typeof normalizeKalshiMarket>['market'];

function makeCandidate(id = 'market-1', lastSnapshotAt: string | null = null) {
  return { id, platform: 'kalshi' as const, platform_id: 'TEST-MARKET', last_snapshot_at: lastSnapshotAt };
}

describe('runGapDetection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockKalshiClient.mockImplementation(
      () => ({ fetchMarket: mockFetchMarket }) as unknown as InstanceType<typeof KalshiClient>
    );
    mockFailOpenRuns.mockResolvedValue(undefined);
    mockStartRun.mockResolvedValue(undefined);
    mockCompleteRun.mockResolvedValue(undefined);
    mockUpdateSourceHealth.mockResolvedValue(undefined);
    mockNormalize.mockReturnValue({ market: NORMALISED_MARKET, platform_raw: {}, warnings: [] });
    mockWriteSnapshots.mockResolvedValue({ kalshi_written: 1, polymarket_written: 0, total_written: 1 });
  });

  it('backfills a stale but still recent market', async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    mockListGapCandidates.mockResolvedValue([makeCandidate('market-1', threeHoursAgo)]);
    mockFetchMarket.mockResolvedValue(RAW_MARKET);

    const result = await runGapDetection();

    expect(result.status).toBe('success');
    expect(result.kalshi_snapshots_written).toBe(1);
    expect(mockWriteSnapshots).toHaveBeenCalled();
  });

  it('records a per-market error and continues with remaining candidates', async () => {
    mockListGapCandidates.mockResolvedValue([makeCandidate('market-1', null), makeCandidate('market-2', null)]);
    mockFetchMarket.mockRejectedValueOnce(new Error('API timeout')).mockResolvedValueOnce(RAW_MARKET);

    const result = await runGapDetection();

    expect(result.status).toBe('partial');
    expect(result.kalshi_errors).toBe(1);
    expect(result.errors[0]?.error_type).toBe('gap_detection_market_failed');
    expect(mockWriteSnapshots).toHaveBeenCalled();
  });

  it('always completes the run record on fatal failure', async () => {
    mockListGapCandidates.mockRejectedValue(new Error('DB down'));

    const result = await runGapDetection();

    expect(result.status).toBe('failed');
    expect(mockCompleteRun).toHaveBeenCalledTimes(1);
  });
});
