export interface KalshiMarketRaw {
  ticker: string;
  event_ticker: string;
  market_type: 'binary' | 'scalar';
  title?: string;
  subtitle?: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  created_time?: string;
  updated_time?: string;
  open_time?: string;
  close_time?: string;
  latest_expiration_time?: string;
  settlement_timer_seconds?: number;
  status: 'initialized' | 'unopened' | 'open' | 'active' | 'closed' | 'settled';
  yes_bid_dollars?: string;
  yes_bid_size_fp?: string;
  yes_ask_dollars?: string;
  yes_ask_size_fp?: string;
  no_bid_dollars?: string;
  no_bid_size_fp?: string;
  no_ask_dollars?: string;
  no_ask_size_fp?: string;
  last_price_dollars?: string;
  liquidity_dollars?: string;
  volume_fp?: string;
  volume_24h_fp?: string;
  open_interest_fp?: string;
  result?: 'yes' | 'no' | '';
  can_close_early?: boolean;
  fractional_trading_enabled?: boolean;
  notional_value_dollars?: string;
  previous_yes_bid_dollars?: string;
  previous_yes_ask_dollars?: string;
  previous_price_dollars?: string;
  strike_type?: string;
  floor_strike?: number;
  cap_strike?: number;
  custom_strike?: Record<string, unknown>;
  functional_strike?: string;
  category?: string;
  rules_primary?: string;
  rules_secondary?: string;
  risk_limit_cents?: number;
  mve_collection_ticker?: string;
  primary_participant_key?: string;
  is_provisional?: boolean;
  series_ticker?: string;
}

export interface KalshiMarketsResponse {
  cursor: string;
  markets: KalshiMarketRaw[];
}

export interface KalshiMarketResponse {
  market: KalshiMarketRaw;
}

export interface KalshiEventRaw {
  event_ticker: string;
  series_ticker: string;
  title: string;
  sub_title?: string;
  status: 'initialized' | 'unopened' | 'open' | 'active' | 'closed' | 'settled';
  category?: string;
  mutually_exclusive?: boolean;
  strike_date?: string;
  strike_period?: string;
  markets?: KalshiMarketRaw[];
}

export interface KalshiEventsResponse {
  cursor: string;
  events: KalshiEventRaw[];
}
