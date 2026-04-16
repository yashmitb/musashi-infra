import type { MarketSnapshot } from '../types/storage.js';
import type {
  EventCluster,
  EventIntelligence,
  RelatedMarket,
  RelationLabel,
  ConfidenceLabel,
  TrustContext,
} from '../types/event.js';
import { selectPrimaryMarket } from './event-clustering.js';

// ---------------------------------------------------------------------------
// Confidence thresholds (rule-based, v1)
// These are intentionally conservative estimates for Kalshi liquidity/volume.
// Tune these constants as real data distributions become better understood.
// ---------------------------------------------------------------------------
const HIGH_LIQUIDITY_THRESHOLD = 10_000;
const MEDIUM_LIQUIDITY_THRESHOLD = 1_000;
const HIGH_VOLUME_THRESHOLD = 1_000;
const MEDIUM_VOLUME_THRESHOLD = 100;

// Probability alignment bounds for relation labeling
const CONFIRM_UPPER = 0.6; // yes_price >= this → "bullish" signal
const CONFIRM_LOWER = 0.4; // yes_price <= this → "bearish" signal

/**
 * Compute the change in yes_price for a market over the last `hoursBack` hours.
 *
 * Returns null if there is insufficient snapshot history (fewer than 2 snapshots
 * for the market, or no snapshot found near the target look-back time).
 */
export function computeProbabilityChange(
  marketId: string,
  snapshots: MarketSnapshot[],
  hoursBack: number,
): number | null {
  const marketSnapshots = snapshots
    .filter((s) => s.market_id === marketId)
    .sort((a, b) => a.snapshot_time.localeCompare(b.snapshot_time));

  if (marketSnapshots.length < 2) return null;

  const latest = marketSnapshots[marketSnapshots.length - 1] as MarketSnapshot;
  const latestTime = new Date(latest.snapshot_time).getTime();
  const targetTime = latestTime - hoursBack * 60 * 60 * 1000;

  // Search all snapshots except the latest for the one closest to targetTime
  let best: MarketSnapshot | undefined;
  let bestDiff = Infinity;

  for (let i = 0; i < marketSnapshots.length - 1; i++) {
    const snapshot = marketSnapshots[i] as MarketSnapshot;
    const diff = Math.abs(new Date(snapshot.snapshot_time).getTime() - targetTime);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = snapshot;
    }
  }

  if (best === undefined) return null;

  return latest.yes_price - best.yes_price;
}

/**
 * Map liquidity / volume / open_interest into a human-readable confidence label.
 *
 * Thresholds (v1 — tune as data distributions are better understood):
 *   high   : liquidity >= 10 000 AND volume_24h >= 1 000
 *   medium : liquidity >= 1 000  OR  volume_24h >= 100
 *   low    : everything else (including all-null inputs)
 */
export function computeConfidenceLabel(
  liquidity: number | null,
  volume24h: number | null,
  _openInterest: number | null,
): ConfidenceLabel {
  const liq = liquidity ?? 0;
  const vol = volume24h ?? 0;

  if (liq >= HIGH_LIQUIDITY_THRESHOLD && vol >= HIGH_VOLUME_THRESHOLD) {
    return 'high';
  }
  if (liq >= MEDIUM_LIQUIDITY_THRESHOLD || vol >= MEDIUM_VOLUME_THRESHOLD) {
    return 'medium';
  }
  return 'low';
}

/**
 * Label the directional relationship between a related market and the primary.
 *
 * Rules (v1):
 *   confirming   : both prices are clearly "bullish" (>= 0.6) or both "bearish" (<= 0.4)
 *   contradicting: one is clearly bullish while the other is clearly bearish
 *   related      : everything else — used as a safe default to avoid over-classification
 */
export function labelRelation(
  primaryYesPrice: number,
  relatedYesPrice: number,
): RelationLabel {
  const primaryBullish = primaryYesPrice >= CONFIRM_UPPER;
  const primaryBearish = primaryYesPrice <= CONFIRM_LOWER;
  const relatedBullish = relatedYesPrice >= CONFIRM_UPPER;
  const relatedBearish = relatedYesPrice <= CONFIRM_LOWER;

  if ((primaryBullish && relatedBullish) || (primaryBearish && relatedBearish)) {
    return 'confirming';
  }
  if ((primaryBullish && relatedBearish) || (primaryBearish && relatedBullish)) {
    return 'contradicting';
  }
  return 'related';
}

/**
 * Build a complete EventIntelligence object from an EventCluster and supporting data.
 *
 * This is a pure function — all DB fetching is the caller's responsibility.
 * Pass the full snapshot history for any markets in the cluster so that
 * probability change calculations have enough data.
 *
 * @param cluster                  The event cluster to summarise
 * @param snapshots                All known snapshots for markets in the cluster
 * @param historicalResolutionCount How many similar markets have resolved historically
 */
export function buildEventIntelligence(
  cluster: EventCluster,
  snapshots: MarketSnapshot[],
  historicalResolutionCount: number,
): EventIntelligence {
  const primary = selectPrimaryMarket(cluster.markets);

  const change24h = computeProbabilityChange(primary.id, snapshots, 24);
  const change7d = computeProbabilityChange(primary.id, snapshots, 7 * 24);

  const relatedMarkets: RelatedMarket[] = cluster.markets
    .filter((m) => m.id !== primary.id)
    .map((m): RelatedMarket => ({
      market_id: m.id,
      title: m.title,
      relation: labelRelation(primary.yes_price, m.yes_price),
      current_probability: m.yes_price,
    }));

  const trustContext: TrustContext = {
    liquidity: primary.liquidity,
    volume_24h: primary.volume_24h,
    open_interest: primary.open_interest,
    historical_resolution_count: historicalResolutionCount,
    confidence_label: computeConfidenceLabel(
      primary.liquidity,
      primary.volume_24h,
      primary.open_interest,
    ),
  };

  return {
    event_id: cluster.cluster_id,
    event_title: primary.title,
    category: primary.category,
    primary_market_id: primary.id,
    primary_market_title: primary.title,
    current_probability: primary.yes_price,
    probability_change_24h: change24h,
    probability_change_7d: change7d,
    closes_at: primary.closes_at,
    related_markets: relatedMarkets,
    trust_context: trustContext,
  };
}
