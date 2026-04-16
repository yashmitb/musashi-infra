import type { MarketCategory, MusashiMarket } from './market.js';

export type RelationLabel = 'confirming' | 'contradicting' | 'related';

export type ConfidenceLabel = 'low' | 'medium' | 'high';

/**
 * Internal grouping of related markets around one real-world event.
 * source='event_id'  → grouped by shared event_id from the platform
 * source='singleton' → no event_id; market stands alone
 */
export interface EventCluster {
  /** Shared event_id, or 'singleton:{market_id}' for ungrouped markets. */
  cluster_id: string;
  source: 'event_id' | 'singleton';
  /** Always non-empty. */
  markets: MusashiMarket[];
}

export interface RelatedMarket {
  market_id: string;
  title: string;
  relation: RelationLabel;
  current_probability: number | null;
}

export interface TrustContext {
  liquidity: number | null;
  volume_24h: number | null;
  open_interest: number | null;
  historical_resolution_count: number;
  confidence_label: ConfidenceLabel;
}

/**
 * Clean, agent-readable summary of one real-world event derived from
 * Musashi market data. This is the primary output of the event layer.
 */
export interface EventIntelligence {
  event_id: string;
  event_title: string;
  category: MarketCategory | null;
  primary_market_id: string;
  primary_market_title: string;
  current_probability: number | null;
  probability_change_24h: number | null;
  probability_change_7d: number | null;
  closes_at: string | null;
  related_markets: RelatedMarket[];
  trust_context: TrustContext;
}
