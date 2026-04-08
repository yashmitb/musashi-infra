import { describe, expect, it, vi } from 'vitest';

import { KalshiClient } from '../../src/api/kalshi-client.js';

describe('KalshiClient', () => {
  it('paginates through all market pages until the cursor is empty', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            cursor: 'next-page',
            markets: [{ ticker: 'ONE', event_ticker: 'EV1', market_type: 'binary', status: 'open' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            cursor: '',
            markets: [{ ticker: 'TWO', event_ticker: 'EV2', market_type: 'binary', status: 'open' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const client = new KalshiClient({
      fetchImpl,
      rateLimitMs: 0,
    });

    const result = await client.fetchAllMarkets();

    expect(result.errors).toEqual([]);
    expect(result.markets.map((market) => market.ticker)).toEqual(['ONE', 'TWO']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns null on 404 market fetches', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404, statusText: 'Not Found' }));
    const client = new KalshiClient({
      fetchImpl,
      rateLimitMs: 0,
    });

    await expect(client.fetchMarket('UNKNOWN')).resolves.toBeNull();
  });

  it('iterates page by page and stops on empty cursor', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            cursor: 'next-page',
            markets: [{ ticker: 'ONE', event_ticker: 'EV1', market_type: 'binary', status: 'open' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            cursor: '',
            markets: [{ ticker: 'TWO', event_ticker: 'EV2', market_type: 'binary', status: 'open' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const client = new KalshiClient({ fetchImpl, rateLimitMs: 0 });
    const tickers: string[] = [];

    for await (const page of client.iterateMarkets({ limit: 2, maxPages: 10 })) {
      tickers.push(...page.markets.map((market) => market.ticker));
    }

    expect(tickers).toEqual(['ONE', 'TWO']);
  });

  it('throws if the cursor repeats', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            cursor: 'same-cursor',
            markets: [{ ticker: 'ONE', event_ticker: 'EV1', market_type: 'binary', status: 'open' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            cursor: 'same-cursor',
            markets: [{ ticker: 'TWO', event_ticker: 'EV2', market_type: 'binary', status: 'open' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const client = new KalshiClient({ fetchImpl, rateLimitMs: 0 });

    await expect(async () => {
      for await (const _page of client.iterateMarkets({ maxPages: 10 })) {
        // exhaust the iterator
      }
    }).rejects.toThrow('cursor repeated');
  });
});
