import { describe, expect, it } from 'vitest';

import { normalizeKalshiBatch, normalizeKalshiMarket } from '../../src/api/normalizer.js';
import type { KalshiMarketRaw } from '../../src/types/kalshi-raw.js';

function buildRaw(overrides: Partial<KalshiMarketRaw> = {}): KalshiMarketRaw {
  return {
    ticker: 'KXBTC-26APR08-B50000',
    event_ticker: 'KXBTC-26APR08',
    series_ticker: 'KXBTC',
    market_type: 'binary',
    title: 'Will Bitcoin be above $50,000 on April 8, 2026?',
    subtitle: 'Bitcoin daily close',
    created_time: '2026-04-08T00:00:00Z',
    close_time: '2026-04-08T23:59:59Z',
    latest_expiration_time: '2026-04-08T23:59:59Z',
    status: 'open',
    yes_bid_dollars: '0.42',
    yes_ask_dollars: '0.44',
    no_bid_dollars: '0.56',
    no_ask_dollars: '0.58',
    last_price_dollars: '0.43',
    liquidity_dollars: '40000',
    volume_fp: '11000.5',
    volume_24h_fp: '2200.25',
    open_interest_fp: '9000',
    result: '',
    category: 'Crypto',
    ...overrides,
  };
}

describe('normalizeKalshiMarket', () => {
  it('normalizes a current Kalshi market payload', () => {
    const fetchedAt = new Date('2026-04-08T12:00:00Z');
    const { market, warnings } = normalizeKalshiMarket(buildRaw(), fetchedAt);

    expect(warnings).toEqual([]);
    expect(market.id).toBe('musashi-kalshi-KXBTC-26APR08-B50000');
    expect(market.platform).toBe('kalshi');
    expect(market.platform_id).toBe('KXBTC-26APR08-B50000');
    expect(market.category).toBe('crypto');
    expect(market.yes_price).toBe(0.43);
    expect(market.no_price).toBe(0.57);
    expect(market.volume_24h).toBe(2200.25);
    expect(market.open_interest).toBe(9000);
    expect(market.liquidity).toBe(40000);
    expect(market.spread).toBe(0.02);
    expect(market.status).toBe('open');
    expect(market.closes_at).toBe('2026-04-08T23:59:59Z');
    expect(market.settles_at).toBe('2026-04-08T23:59:59Z');
    expect(market.resolved).toBe(false);
    expect(market.resolution).toBeNull();
  });

  it('falls back to bid ask midpoint when last price is missing', () => {
    const raw = buildRaw();
    delete raw.last_price_dollars;
    const { market } = normalizeKalshiMarket(raw, new Date('2026-04-08T12:00:00Z'));

    expect(market.yes_price).toBe(0.43);
    expect(market.no_price).toBe(0.57);
  });

  it('marks settled yes markets as resolved', () => {
    const { market } = normalizeKalshiMarket(
      buildRaw({
        status: 'settled',
        result: 'yes',
      }),
      new Date('2026-04-08T12:00:00Z')
    );

    expect(market.status).toBe('resolved');
    expect(market.resolved).toBe(true);
    expect(market.resolution).toBe('YES');
  });

  it('marks finalized markets as resolved', () => {
    const { market } = normalizeKalshiMarket(
      buildRaw({
        status: 'finalized',
        result: 'no',
      }),
      new Date('2026-04-08T12:00:00Z')
    );

    expect(market.status).toBe('resolved');
    expect(market.resolved).toBe(true);
    expect(market.resolution).toBe('NO');
  });

  it('throws when no usable price fields are present', () => {
    const raw = buildRaw();
    delete raw.last_price_dollars;
    delete raw.yes_bid_dollars;
    delete raw.yes_ask_dollars;

    expect(() => normalizeKalshiMarket(raw, new Date('2026-04-08T12:00:00Z'))).toThrow('missing usable price fields');
  });
});

describe('normalizeKalshiBatch', () => {
  it('collects normalization failures without stopping the batch', () => {
    const broken = buildRaw({
      ticker: 'BROKEN',
    });
    delete broken.title;

    const result = normalizeKalshiBatch([buildRaw(), broken], new Date('2026-04-08T12:00:00Z'));

    expect(result.normalized).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.platform_id).toBe('BROKEN');
  });
});
