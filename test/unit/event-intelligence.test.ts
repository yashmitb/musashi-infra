import { describe, expect, it } from 'vitest';

import {
  buildEventIntelligence,
  computeConfidenceLabel,
  computeProbabilityChange,
  labelRelation,
} from '../../src/lib/event-intelligence.js';
import type { EventCluster } from '../../src/types/event.js';
import type { MusashiMarket } from '../../src/types/market.js';
import type { MarketSnapshot } from '../../src/types/storage.js';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

let _seq = 0;

function buildMarket(overrides: Partial<MusashiMarket> = {}): MusashiMarket {
  _seq++;
  return {
    id: `musashi-kalshi-m${_seq}`,
    platform: 'kalshi',
    platform_id: `M${_seq}`,
    event_id: 'TEST-EVENT',
    series_id: null,
    title: `Market ${_seq}`,
    description: null,
    category: 'economics',
    url: `https://kalshi.com/markets/m${_seq}`,
    yes_price: 0.5,
    no_price: 0.5,
    volume_24h: 0,
    open_interest: null,
    liquidity: null,
    spread: null,
    status: 'open',
    created_at: '2026-04-10T00:00:00Z',
    closes_at: '2026-05-01T00:00:00Z',
    settles_at: null,
    resolved: false,
    resolution: null,
    resolved_at: null,
    fetched_at: '2026-04-14T00:00:00Z',
    cache_hit: false,
    data_age_seconds: 0,
    ...overrides,
  };
}

function buildSnapshot(
  marketId: string,
  snapshotTime: string,
  yesPrice: number,
): MarketSnapshot {
  return {
    market_id: marketId,
    snapshot_time: snapshotTime,
    yes_price: yesPrice,
    no_price: 1 - yesPrice,
    volume_24h: null,
    open_interest: null,
    liquidity: null,
    spread: null,
    source: 'kalshi',
    fetch_latency_ms: null,
    created_at: snapshotTime,
  };
}

function buildCluster(markets: MusashiMarket[]): EventCluster {
  return { cluster_id: 'TEST-EVENT', source: 'event_id', markets };
}

// ---------------------------------------------------------------------------
// computeProbabilityChange
// ---------------------------------------------------------------------------

describe('computeProbabilityChange', () => {
  it('returns null when there are no snapshots for the market', () => {
    expect(computeProbabilityChange('musashi-kalshi-m1', [], 24)).toBeNull();
  });

  it('returns null when there is only one snapshot (no history to compare)', () => {
    const snapshots = [buildSnapshot('musashi-kalshi-m1', '2026-04-14T12:00:00Z', 0.6)];
    expect(computeProbabilityChange('musashi-kalshi-m1', snapshots, 24)).toBeNull();
  });

  it('returns null for an unknown market_id', () => {
    const snapshots = [
      buildSnapshot('musashi-kalshi-other', '2026-04-13T12:00:00Z', 0.5),
      buildSnapshot('musashi-kalshi-other', '2026-04-14T12:00:00Z', 0.6),
    ];
    expect(computeProbabilityChange('musashi-kalshi-m1', snapshots, 24)).toBeNull();
  });

  it('computes 24h change correctly (positive move)', () => {
    const id = 'musashi-kalshi-m99';
    const snapshots = [
      buildSnapshot(id, '2026-04-13T12:00:00Z', 0.5), // ~24h ago
      buildSnapshot(id, '2026-04-14T12:00:00Z', 0.65), // now
    ];
    const result = computeProbabilityChange(id, snapshots, 24);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(0.15);
  });

  it('computes 24h change correctly (negative move)', () => {
    const id = 'musashi-kalshi-m99';
    const snapshots = [
      buildSnapshot(id, '2026-04-13T12:00:00Z', 0.7),
      buildSnapshot(id, '2026-04-14T12:00:00Z', 0.55),
    ];
    const result = computeProbabilityChange(id, snapshots, 24);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(-0.15);
  });

  it('computes 7d change correctly', () => {
    const id = 'musashi-kalshi-m99';
    const snapshots = [
      buildSnapshot(id, '2026-04-07T00:00:00Z', 0.4),  // ~7d ago
      buildSnapshot(id, '2026-04-10T00:00:00Z', 0.45), // intermediate
      buildSnapshot(id, '2026-04-14T00:00:00Z', 0.6),  // current
    ];
    const result = computeProbabilityChange(id, snapshots, 7 * 24);
    expect(result).not.toBeNull();
    // Should pick the snapshot closest to 7d ago (April 7) vs current (April 14)
    expect(result!).toBeCloseTo(0.2);
  });

  it('picks the snapshot closest to the target look-back time', () => {
    const id = 'musashi-kalshi-m99';
    // Target is 24h before the latest; April 10 is closer to April 13 than April 7
    const snapshots = [
      buildSnapshot(id, '2026-04-07T00:00:00Z', 0.3), // 7d ago
      buildSnapshot(id, '2026-04-10T00:00:00Z', 0.4), // 4d ago — closest to 24h target relative to April 11
      buildSnapshot(id, '2026-04-14T00:00:00Z', 0.6), // current
    ];
    // 24h before April 14 = April 13. Closest snapshot to April 13 is April 10
    const result = computeProbabilityChange(id, snapshots, 24);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(0.2); // 0.6 - 0.4
  });

  it('ignores snapshots from other markets', () => {
    const id = 'musashi-kalshi-m99';
    const snapshots = [
      buildSnapshot('musashi-kalshi-other', '2026-04-13T12:00:00Z', 0.9),
      buildSnapshot(id, '2026-04-13T12:00:00Z', 0.5),
      buildSnapshot(id, '2026-04-14T12:00:00Z', 0.6),
    ];
    const result = computeProbabilityChange(id, snapshots, 24);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(0.1);
  });
});

// ---------------------------------------------------------------------------
// computeConfidenceLabel
// ---------------------------------------------------------------------------

describe('computeConfidenceLabel', () => {
  it('returns high when liquidity and volume both meet thresholds', () => {
    expect(computeConfidenceLabel(10_000, 1_000, null)).toBe('high');
  });

  it('returns high with room to spare above thresholds', () => {
    expect(computeConfidenceLabel(50_000, 5_000, 20_000)).toBe('high');
  });

  it('returns medium when only liquidity meets medium threshold', () => {
    expect(computeConfidenceLabel(1_000, 0, null)).toBe('medium');
  });

  it('returns medium when only volume meets medium threshold', () => {
    expect(computeConfidenceLabel(0, 100, null)).toBe('medium');
  });

  it('returns medium when liquidity meets medium but volume does not meet high', () => {
    expect(computeConfidenceLabel(5_000, 50, null)).toBe('medium');
  });

  it('returns low when all inputs are zero', () => {
    expect(computeConfidenceLabel(0, 0, 0)).toBe('low');
  });

  it('returns low when all inputs are null', () => {
    expect(computeConfidenceLabel(null, null, null)).toBe('low');
  });

  it('returns low when liquidity is null and volume is below medium threshold', () => {
    expect(computeConfidenceLabel(null, 50, null)).toBe('low');
  });

  it('returns low when liquidity is below medium threshold and volume is zero', () => {
    expect(computeConfidenceLabel(500, 0, null)).toBe('low');
  });

  it('does not reach high if liquidity meets threshold but volume does not', () => {
    expect(computeConfidenceLabel(10_000, 999, null)).toBe('medium');
  });

  it('does not reach high if volume meets threshold but liquidity does not', () => {
    expect(computeConfidenceLabel(9_999, 1_000, null)).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// labelRelation
// ---------------------------------------------------------------------------

describe('labelRelation', () => {
  it('returns confirming when both prices are bullish (>= 0.6)', () => {
    expect(labelRelation(0.75, 0.65)).toBe('confirming');
  });

  it('returns confirming when both prices are bearish (<= 0.4)', () => {
    expect(labelRelation(0.25, 0.35)).toBe('confirming');
  });

  it('returns contradicting when primary is bullish and related is bearish', () => {
    expect(labelRelation(0.8, 0.2)).toBe('contradicting');
  });

  it('returns contradicting when primary is bearish and related is bullish', () => {
    expect(labelRelation(0.2, 0.8)).toBe('contradicting');
  });

  it('returns related when both prices are near 0.5 (ambiguous zone)', () => {
    expect(labelRelation(0.5, 0.5)).toBe('related');
  });

  it('returns related when primary is ambiguous even if related is bullish', () => {
    expect(labelRelation(0.5, 0.8)).toBe('related');
  });

  it('returns related when both prices are on the 0.4–0.6 boundary', () => {
    expect(labelRelation(0.45, 0.55)).toBe('related');
  });

  it('does not over-classify at boundary values', () => {
    // Exactly 0.4 and 0.6 are on the thresholds
    expect(labelRelation(0.4, 0.4)).toBe('confirming');
    expect(labelRelation(0.6, 0.6)).toBe('confirming');
    expect(labelRelation(0.41, 0.59)).toBe('related'); // just inside ambiguous zone
  });
});

// ---------------------------------------------------------------------------
// buildEventIntelligence
// ---------------------------------------------------------------------------

describe('buildEventIntelligence', () => {
  it('returns an object with all required top-level fields', () => {
    const market = buildMarket({ liquidity: 5_000, volume_24h: 200 });
    const cluster = buildCluster([market]);

    const result = buildEventIntelligence(cluster, [], 0);

    // All required fields must be present (not undefined)
    expect(result).toHaveProperty('event_id');
    expect(result).toHaveProperty('event_title');
    expect(result).toHaveProperty('category');
    expect(result).toHaveProperty('primary_market_id');
    expect(result).toHaveProperty('primary_market_title');
    expect(result).toHaveProperty('current_probability');
    expect(result).toHaveProperty('probability_change_24h');
    expect(result).toHaveProperty('probability_change_7d');
    expect(result).toHaveProperty('closes_at');
    expect(result).toHaveProperty('related_markets');
    expect(result).toHaveProperty('trust_context');
  });

  it('trust_context contains all required sub-fields', () => {
    const market = buildMarket();
    const cluster = buildCluster([market]);

    const { trust_context } = buildEventIntelligence(cluster, [], 0);

    expect(trust_context).toHaveProperty('liquidity');
    expect(trust_context).toHaveProperty('volume_24h');
    expect(trust_context).toHaveProperty('open_interest');
    expect(trust_context).toHaveProperty('historical_resolution_count');
    expect(trust_context).toHaveProperty('confidence_label');
  });

  it('event_id is the cluster_id', () => {
    const market = buildMarket();
    const cluster: EventCluster = { cluster_id: 'MY-EVENT', source: 'event_id', markets: [market] };

    const result = buildEventIntelligence(cluster, [], 0);

    expect(result.event_id).toBe('MY-EVENT');
  });

  it('uses the primary market title as event_title', () => {
    const primary = buildMarket({ liquidity: 10_000, title: 'Will the Fed cut in Sep?' });
    const secondary = buildMarket({ liquidity: 100, title: 'Other question' });
    const cluster = buildCluster([secondary, primary]);

    const result = buildEventIntelligence(cluster, [], 0);

    expect(result.event_title).toBe('Will the Fed cut in Sep?');
    expect(result.primary_market_id).toBe(primary.id);
  });

  it('sets probability_change_24h and _7d to null when no snapshots exist', () => {
    const market = buildMarket();
    const cluster = buildCluster([market]);

    const result = buildEventIntelligence(cluster, [], 0);

    expect(result.probability_change_24h).toBeNull();
    expect(result.probability_change_7d).toBeNull();
  });

  it('computes probability changes when sufficient snapshots are provided', () => {
    const market = buildMarket({ id: 'musashi-kalshi-m999' });
    const cluster = buildCluster([market]);
    const snapshots = [
      buildSnapshot(market.id, '2026-04-13T00:00:00Z', 0.4),
      buildSnapshot(market.id, '2026-04-14T00:00:00Z', 0.55),
    ];

    const result = buildEventIntelligence(cluster, snapshots, 0);

    expect(result.probability_change_24h).not.toBeNull();
    expect(result.probability_change_24h!).toBeCloseTo(0.15);
  });

  it('includes all cluster members except the primary in related_markets', () => {
    const primary = buildMarket({ liquidity: 50_000 });
    const rel1 = buildMarket({ liquidity: 100 });
    const rel2 = buildMarket({ liquidity: 200 });
    const cluster = buildCluster([primary, rel1, rel2]);

    const result = buildEventIntelligence(cluster, [], 0);

    expect(result.related_markets).toHaveLength(2);
    const relatedIds = result.related_markets.map((r) => r.market_id);
    expect(relatedIds).toContain(rel1.id);
    expect(relatedIds).toContain(rel2.id);
    expect(relatedIds).not.toContain(primary.id);
  });

  it('labels related markets with a valid RelationLabel', () => {
    const primary = buildMarket({ liquidity: 50_000, yes_price: 0.8, no_price: 0.2 });
    const confirming = buildMarket({ yes_price: 0.75, no_price: 0.25 });
    const contradicting = buildMarket({ yes_price: 0.2, no_price: 0.8 });
    const ambiguous = buildMarket({ yes_price: 0.5, no_price: 0.5 });
    const cluster = buildCluster([primary, confirming, contradicting, ambiguous]);

    const result = buildEventIntelligence(cluster, [], 0);

    const find = (id: string) => result.related_markets.find((r) => r.market_id === id);

    expect(find(confirming.id)?.relation).toBe('confirming');
    expect(find(contradicting.id)?.relation).toBe('contradicting');
    expect(find(ambiguous.id)?.relation).toBe('related');
  });

  it('produces empty related_markets for a singleton cluster', () => {
    const market = buildMarket();
    const cluster: EventCluster = {
      cluster_id: `singleton:${market.id}`,
      source: 'singleton',
      markets: [market],
    };

    const result = buildEventIntelligence(cluster, [], 0);

    expect(result.related_markets).toHaveLength(0);
  });

  it('stores historical_resolution_count in trust_context', () => {
    const market = buildMarket();
    const cluster = buildCluster([market]);

    const result = buildEventIntelligence(cluster, [], 42);

    expect(result.trust_context.historical_resolution_count).toBe(42);
  });

  it('trust_context reflects null liquidity safely', () => {
    const market = buildMarket({ liquidity: null, open_interest: null, volume_24h: 0 });
    const cluster = buildCluster([market]);

    const result = buildEventIntelligence(cluster, [], 0);

    expect(result.trust_context.liquidity).toBeNull();
    expect(result.trust_context.confidence_label).toBe('low');
  });

  it('derives category from the primary market', () => {
    const market = buildMarket({ category: 'fed_policy', liquidity: 999 });
    const cluster = buildCluster([market]);

    const result = buildEventIntelligence(cluster, [], 0);

    expect(result.category).toBe('fed_policy');
  });

  it('exposes current_probability as the primary market yes_price', () => {
    const market = buildMarket({ yes_price: 0.72, no_price: 0.28 });
    const cluster = buildCluster([market]);

    const result = buildEventIntelligence(cluster, [], 0);

    expect(result.current_probability).toBeCloseTo(0.72);
  });

  it('no field is silently omitted — all keys are explicitly present', () => {
    const market = buildMarket();
    const cluster = buildCluster([market]);
    const result = buildEventIntelligence(cluster, [], 0);

    const requiredKeys: (keyof typeof result)[] = [
      'event_id',
      'event_title',
      'category',
      'primary_market_id',
      'primary_market_title',
      'current_probability',
      'probability_change_24h',
      'probability_change_7d',
      'closes_at',
      'related_markets',
      'trust_context',
    ];

    for (const key of requiredKeys) {
      expect(result, `key "${key}" must be present`).toHaveProperty(key);
      // The field must exist on the object (value may legitimately be null)
      expect(Object.prototype.hasOwnProperty.call(result, key)).toBe(true);
    }
  });
});
