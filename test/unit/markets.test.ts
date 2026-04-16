import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/supabase.js', () => ({
  getSupabase: vi.fn(),
}));

import { listResolutionCandidates } from '../../src/db/markets.js';
import { getSupabase } from '../../src/db/supabase.js';

interface CandidateRow {
  id: string;
  platform: 'kalshi';
  platform_id: string;
  closes_at: string;
  settles_at: string;
}

function makeCandidateRow(id: string): CandidateRow {
  return {
    id,
    platform: 'kalshi',
    platform_id: id.toUpperCase(),
    closes_at: '2026-01-01T00:00:00Z',
    settles_at: '2026-01-01T00:00:00Z',
  };
}

function makeSupabaseMock(batches: { terminal: CandidateRow[]; open: CandidateRow[] }) {
  const from = vi.fn(() => {
    const state: {
      limit?: number;
      statusBucket?: 'terminal' | 'open';
    } = {};

    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => {
        if (column === 'status' && value === 'open') {
          state.statusBucket = 'open';
        }

        return builder;
      }),
      or: vi.fn(() => builder),
      in: vi.fn((column: string, values: string[]) => {
        if (column === 'status' && values.includes('closed') && values.includes('resolved')) {
          state.statusBucket = 'terminal';
        }

        return builder;
      }),
      not: vi.fn(() => builder),
      lte: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn((value: number) => {
        state.limit = value;
        return builder;
      }),
      then: (onFulfilled: (value: { data: CandidateRow[]; error: null }) => unknown) => {
        const source = state.statusBucket === 'open' ? batches.open : batches.terminal;
        const data = state.limit === undefined ? source : source.slice(0, state.limit);
        return Promise.resolve(onFulfilled({ data, error: null }));
      },
    };

    return builder;
  });

  vi.mocked(getSupabase).mockReturnValue({
    from,
  } as unknown as ReturnType<typeof getSupabase>);

  return { from };
}

describe('listResolutionCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prioritizes terminal candidates before open candidates', async () => {
    makeSupabaseMock({
      terminal: [makeCandidateRow('terminal-1')],
      open: [makeCandidateRow('open-1'), makeCandidateRow('open-2')],
    });

    const result = await listResolutionCandidates(new Date('2026-01-02T00:00:00Z'), 2);

    expect(result.map((candidate) => candidate.id)).toEqual(['terminal-1', 'open-1']);
  });

  it('does not query open candidates when terminal candidates already fill the limit', async () => {
    const { from } = makeSupabaseMock({
      terminal: [makeCandidateRow('terminal-1'), makeCandidateRow('terminal-2')],
      open: [makeCandidateRow('open-1')],
    });

    const result = await listResolutionCandidates(new Date('2026-01-02T00:00:00Z'), 2);

    expect(result.map((candidate) => candidate.id)).toEqual(['terminal-1', 'terminal-2']);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('returns all terminal and open candidates when no limit is provided', async () => {
    makeSupabaseMock({
      terminal: [makeCandidateRow('terminal-1')],
      open: [makeCandidateRow('open-1')],
    });

    const result = await listResolutionCandidates(new Date('2026-01-02T00:00:00Z'));

    expect(result.map((candidate) => candidate.id)).toEqual(['terminal-1', 'open-1']);
  });
});
