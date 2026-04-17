import type { MusashiMarket } from '../types/market.js';
import type { EventCluster } from '../types/event.js';

/**
 * Group a flat list of markets into EventClusters.
 *
 * Primary rule: markets that share a non-empty event_id are clustered together.
 * Fallback: markets with null or blank event_id each form their own singleton
 * cluster rather than being merged — this avoids false groupings.
 */
export function clusterMarkets(markets: MusashiMarket[]): EventCluster[] {
  const byEventId = new Map<string, MusashiMarket[]>();
  const singletons: MusashiMarket[] = [];

  for (const market of markets) {
    const eid = market.event_id;
    if (eid !== null && eid.trim().length > 0) {
      const existing = byEventId.get(eid);
      if (existing !== undefined) {
        existing.push(market);
      } else {
        byEventId.set(eid, [market]);
      }
    } else {
      singletons.push(market);
    }
  }

  const clusters: EventCluster[] = [];

  for (const [eid, group] of byEventId) {
    clusters.push({ cluster_id: eid, source: 'event_id', markets: group });
  }

  for (const market of singletons) {
    clusters.push({
      cluster_id: `singleton:${market.id}`,
      source: 'singleton',
      markets: [market],
    });
  }

  return clusters;
}

/**
 * Pick one primary market from a cluster using deterministic rules:
 *   1. Highest liquidity (nulls last)
 *   2. Highest open_interest (nulls last)
 *   3. Highest volume_24h
 *   4. Earliest closes_at (nulls last)
 *   5. Lexicographic id (final stable tiebreaker)
 */
export function selectPrimaryMarket(markets: MusashiMarket[]): MusashiMarket {
  if (markets.length === 0) {
    throw new Error('selectPrimaryMarket: markets array must not be empty');
  }

  const sorted = [...markets].sort((a, b) => {
    const byLiquidity = compareNullableDesc(a.liquidity, b.liquidity);
    if (byLiquidity !== 0) return byLiquidity;

    const byOI = compareNullableDesc(a.open_interest, b.open_interest);
    if (byOI !== 0) return byOI;

    const byVolume = b.volume_24h - a.volume_24h;
    if (byVolume !== 0) return byVolume;

    const byClose = compareNullableStringAsc(a.closes_at, b.closes_at);
    if (byClose !== 0) return byClose;

    return a.id.localeCompare(b.id);
  });

  // sorted[0] is guaranteed to exist because markets.length > 0
  return sorted[0] as MusashiMarket;
}

// ---------------------------------------------------------------------------
// Helpers (not exported — internal to this module)
// ---------------------------------------------------------------------------

function compareNullableDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // null ranks lower → goes after real values
  if (b === null) return -1;
  return b - a; // descending: larger value first
}

function compareNullableStringAsc(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // null ranks lower → goes after real values
  if (b === null) return -1;
  return a.localeCompare(b); // ascending: earlier date first
}
