import { describe, expect, it } from 'vitest';

import { isMusashiMarket, type MusashiMarket } from '../../src/types/market.js';

function buildValidMarket(): MusashiMarket {
  return {
    id: 'musashi-kalshi-KXBTC-26APR08-B50000',
    platform: 'kalshi',
    platform_id: 'KXBTC-26APR08-B50000',
    event_id: 'KXBTC-26APR08',
    series_id: 'KXBTC',
    title: 'Will Bitcoin be above $50,000 on April 8, 2026?',
    description: null,
    category: 'crypto',
    url: 'https://kalshi.com/markets/KXBTC-26APR08/KXBTC-26APR08-B50000',
    yes_price: 0.43,
    no_price: 0.57,
    volume_24h: 1200,
    open_interest: 8200,
    liquidity: 40000,
    spread: 0.02,
    status: 'open',
    created_at: '2026-04-08T00:00:00.000Z',
    closes_at: '2026-04-08T23:59:59.000Z',
    settles_at: '2026-04-08T23:59:59.000Z',
    resolved: false,
    resolution: null,
    resolved_at: null,
    fetched_at: '2026-04-08T12:00:00.000Z',
    cache_hit: false,
    data_age_seconds: 0,
  };
}

describe('isMusashiMarket', () => {
  it('accepts a valid market', () => {
    expect(isMusashiMarket(buildValidMarket())).toBe(true);
  });

  it('rejects a market whose prices do not sum to one', () => {
    const market = buildValidMarket();
    market.no_price = 0.5;

    expect(isMusashiMarket(market)).toBe(false);
  });

  it('rejects a market with an invalid category', () => {
    const market = {
      ...buildValidMarket(),
      category: 'finance',
    };

    expect(isMusashiMarket(market)).toBe(false);
  });

  it('rejects a non-object value', () => {
    expect(isMusashiMarket(null)).toBe(false);
    expect(isMusashiMarket('market')).toBe(false);
  });
});
