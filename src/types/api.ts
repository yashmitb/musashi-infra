export interface SourceStatus {
  available: boolean;
  last_successful_fetch: string | null;
  error: string | null;
  market_count: number;
}

export interface FreshnessMetadata {
  data_age_seconds: number;
  oldest_fetched_at: string;
  sources: {
    kalshi: SourceStatus;
    polymarket: SourceStatus;
  };
}

export interface MusashiApiResponse<T> {
  success: boolean;
  data: T;
  freshness: FreshnessMetadata;
  metadata: {
    processing_time_ms: number;
    result_count: number;
    [key: string]: unknown;
  };
  error?: string;
}
