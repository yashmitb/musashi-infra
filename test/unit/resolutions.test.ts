import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Module mocks ---

vi.mock('../../src/db/supabase.js', () => ({
  getSupabase: vi.fn(),
}));

// --- Imports after mocks ---

import { getSupabase } from '../../src/db/supabase.js';
import { insertResolution } from '../../src/db/resolutions.js';
import type { MarketResolution } from '../../src/types/storage.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a minimal Supabase query-builder mock that is both chainable (each
 * method returns `this`) and awaitable (has a `then` that resolves to
 * `terminalResult`).  This covers the `update().eq().eq()` pattern used by
 * the repair path.
 */
function makeBuilder({
  maybeSingleResult = { data: null as unknown, error: null as null | { message: string } },
  insertResult = { error: null as null | { message: string } },
  terminalResult = { error: null as null | { message: string } },
} = {}) {
  const b: Record<string, unknown> & {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  } = {
    select: vi.fn(),
    eq: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(() => Promise.resolve(insertResult)),
    maybeSingle: vi.fn(() => Promise.resolve(maybeSingleResult)),
    // Makes the builder itself awaitable so `await builder.update().eq().eq()` works
    then: (resolve: (val: unknown) => unknown, reject?: (err: unknown) => unknown) =>
      Promise.resolve(terminalResult).then(resolve, reject),
  };

  // Chain-returning methods
  b.select.mockReturnValue(b);
  b.eq.mockReturnValue(b);
  b.update.mockReturnValue(b);

  return b;
}

const RESOLUTION: MarketResolution = {
  market_id: 'market-1',
  outcome: 'YES',
  resolved_at: '2026-01-01T00:00:00Z',
  final_yes_price: 0.72,
  resolution_source: 'kalshi_api_v2',
  detected_at: '2026-01-01T01:00:00Z',
};

describe('insertResolution', () => {
  let resBuilder: ReturnType<typeof makeBuilder>;
  let marketsBuilder: ReturnType<typeof makeBuilder>;

  beforeEach(() => {
    vi.clearAllMocks();
    resBuilder = makeBuilder();
    marketsBuilder = makeBuilder();

    vi.mocked(getSupabase).mockReturnValue({
      from: vi.fn((table: string) =>
        table === 'market_resolutions' ? resBuilder : marketsBuilder,
      ),
    } as unknown as ReturnType<typeof getSupabase>);
  });

  // -------------------------------------------------------------------------
  // Happy path — new resolution
  // -------------------------------------------------------------------------

  it('inserts a new resolution and updates the market, returning true', async () => {
    // No existing resolution
    resBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await insertResolution(RESOLUTION);

    expect(result).toBe(true);
    expect(resBuilder.insert).toHaveBeenCalledWith(RESOLUTION);
    expect(marketsBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ resolved: true, resolution: 'YES' }),
    );
  });

  it('sets the correct resolution outcome for a NO market', async () => {
    resBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
    const noResolution: MarketResolution = { ...RESOLUTION, outcome: 'NO' };

    await insertResolution(noResolution);

    expect(marketsBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: 'NO' }),
    );
  });

  // -------------------------------------------------------------------------
  // Idempotency — resolution already exists
  // -------------------------------------------------------------------------

  it('returns false and does not re-insert when resolution already exists', async () => {
    resBuilder.maybeSingle.mockResolvedValue({
      data: { market_id: 'market-1' },
      error: null,
    });

    const result = await insertResolution(RESOLUTION);

    expect(result).toBe(false);
    expect(resBuilder.insert).not.toHaveBeenCalled();
  });

  it('repairs the market row when resolution exists but market.resolved is still false', async () => {
    resBuilder.maybeSingle.mockResolvedValue({
      data: { market_id: 'market-1' },
      error: null,
    });

    await insertResolution(RESOLUTION);

    // Repair update must be issued
    expect(marketsBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        resolved: true,
        status: 'resolved',
        resolution: 'YES',
        resolved_at: '2026-01-01T00:00:00Z',
      }),
    );
    // Guard filter: only touch rows that are still unresolved
    expect(marketsBuilder.eq).toHaveBeenCalledWith('resolved', false);
  });

  // -------------------------------------------------------------------------
  // Error paths
  // -------------------------------------------------------------------------

  it('throws when the initial resolution query fails', async () => {
    resBuilder.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'connection lost' },
    });

    await expect(insertResolution(RESOLUTION)).rejects.toThrow('connection lost');
  });

  it('throws when the resolution insert fails', async () => {
    resBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
    resBuilder.insert.mockResolvedValue({ error: { message: 'unique constraint' } });

    await expect(insertResolution(RESOLUTION)).rejects.toThrow('unique constraint');
  });

  it('throws when the market update fails after a successful resolution insert', async () => {
    resBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
    resBuilder.insert.mockResolvedValue({ error: null });
    marketsBuilder = makeBuilder({ terminalResult: { error: { message: 'markets update failed' } } });

    vi.mocked(getSupabase).mockReturnValue({
      from: vi.fn((table: string) =>
        table === 'market_resolutions' ? resBuilder : marketsBuilder,
      ),
    } as unknown as ReturnType<typeof getSupabase>);

    await expect(insertResolution(RESOLUTION)).rejects.toThrow('markets update failed');
  });

  it('throws when the repair update fails', async () => {
    resBuilder.maybeSingle.mockResolvedValue({
      data: { market_id: 'market-1' },
      error: null,
    });
    marketsBuilder = makeBuilder({ terminalResult: { error: { message: 'repair failed' } } });

    vi.mocked(getSupabase).mockReturnValue({
      from: vi.fn((table: string) =>
        table === 'market_resolutions' ? resBuilder : marketsBuilder,
      ),
    } as unknown as ReturnType<typeof getSupabase>);

    await expect(insertResolution(RESOLUTION)).rejects.toThrow('repair failed');
  });
});
