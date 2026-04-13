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
 * Creates a minimal Supabase query-builder mock covering the patterns used by
 * insertResolutions: select().in() (terminal promise) and insert() (terminal promise).
 */
function makeBuilder({
  inResult = { data: [] as unknown[], error: null as null | { message: string } },
  insertResult = { error: null as null | { message: string } },
} = {}) {
  const b: Record<string, unknown> & {
    select: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
  } = {
    select: vi.fn(),
    in: vi.fn(() => Promise.resolve(inResult)),
    insert: vi.fn(() => Promise.resolve(insertResult)),
  };

  // select() is chainable; .in() terminates
  b.select.mockReturnValue(b);

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

  beforeEach(() => {
    vi.clearAllMocks();
    resBuilder = makeBuilder();

    vi.mocked(getSupabase).mockReturnValue({
      from: vi.fn(() => resBuilder),
    } as unknown as ReturnType<typeof getSupabase>);
  });

  // -------------------------------------------------------------------------
  // Happy path — new resolution
  // -------------------------------------------------------------------------

  it('inserts a new resolution, returning true', async () => {
    // No existing resolution
    resBuilder.in.mockResolvedValue({ data: [], error: null });

    const result = await insertResolution(RESOLUTION);

    expect(result).toBe(true);
    expect(resBuilder.insert).toHaveBeenCalledWith([RESOLUTION]);
  });

  it('sets the correct resolution outcome for a NO market', async () => {
    resBuilder.in.mockResolvedValue({ data: [], error: null });
    const noResolution: MarketResolution = { ...RESOLUTION, outcome: 'NO' };

    await insertResolution(noResolution);

    expect(resBuilder.insert).toHaveBeenCalledWith([noResolution]);
  });

  // -------------------------------------------------------------------------
  // Idempotency — resolution already exists
  // -------------------------------------------------------------------------

  it('returns false and does not re-insert when resolution already exists', async () => {
    resBuilder.in.mockResolvedValue({
      data: [{ market_id: 'market-1' }],
      error: null,
    });

    const result = await insertResolution(RESOLUTION);

    expect(result).toBe(false);
    expect(resBuilder.insert).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Error paths
  // -------------------------------------------------------------------------

  it('throws when the initial resolution query fails', async () => {
    resBuilder.in.mockResolvedValue({
      data: null,
      error: { message: 'connection lost' },
    });

    await expect(insertResolution(RESOLUTION)).rejects.toThrow('connection lost');
  });

  it('throws when the resolution insert fails', async () => {
    resBuilder.in.mockResolvedValue({ data: [], error: null });
    resBuilder.insert.mockResolvedValue({ error: { message: 'unique constraint' } });

    await expect(insertResolution(RESOLUTION)).rejects.toThrow('unique constraint');
  });
});
