import type { ResolutionOutcome } from './market.js';

export type IngestionStatus = 'running' | 'success' | 'partial' | 'failed';

export interface MarketSnapshot {
  market_id: string;
  snapshot_time: string;
  yes_price: number;
  no_price: number;
  volume_24h: number | null;
  open_interest: number | null;
  liquidity: number | null;
  spread: number | null;
  source: string;
  fetch_latency_ms: number | null;
  created_at: string;
}

export interface MarketResolution {
  market_id: string;
  outcome: ResolutionOutcome;
  resolved_at: string;
  final_yes_price: number | null;
  resolution_source: string;
  detected_at: string;
}

export interface IngestionRunError {
  source: string;
  error_type: string;
  error_message: string;
  market_id?: string;
}

export interface IngestionRunRecord {
  job_id: string;
  run_type: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  kalshi_markets_fetched: number;
  kalshi_markets_new: number;
  kalshi_snapshots_written: number;
  kalshi_errors: number;
  kalshi_available: boolean;
  kalshi_fetch_ms: number | null;
  polymarket_markets_fetched: number;
  polymarket_markets_new: number;
  polymarket_snapshots_written: number;
  polymarket_errors: number;
  polymarket_available: boolean;
  polymarket_fetch_ms: number | null;
  resolutions_detected: number;
  errors: IngestionRunError[];
  status: IngestionStatus;
  notes: string | null;
}

export interface SyncCheckpoint {
  checkpoint_key: string;
  run_type: string;
  cursor: string | null;
  page_count: number;
  market_count: number;
  snapshot_time: string | null;
  job_id: string | null;
  updated_at: string;
}
