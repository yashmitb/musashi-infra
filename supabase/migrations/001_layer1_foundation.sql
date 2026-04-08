CREATE TYPE market_platform AS ENUM ('kalshi', 'polymarket');

CREATE TYPE market_category AS ENUM (
  'fed_policy',
  'economics',
  'financial_markets',
  'us_politics',
  'geopolitics',
  'technology',
  'crypto',
  'sports',
  'climate',
  'entertainment',
  'other'
);

CREATE TYPE market_status AS ENUM ('open', 'closed', 'resolved');

CREATE TYPE resolution_outcome AS ENUM ('YES', 'NO');

CREATE TYPE ingestion_status AS ENUM ('running', 'success', 'partial', 'failed');

CREATE TABLE markets (
  id TEXT PRIMARY KEY,
  platform market_platform NOT NULL,
  platform_id TEXT NOT NULL,
  event_id TEXT,
  series_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  category market_category NOT NULL DEFAULT 'other',
  url TEXT NOT NULL,
  yes_price NUMERIC(8,6) NOT NULL CHECK (yes_price >= 0 AND yes_price <= 1),
  no_price NUMERIC(8,6) NOT NULL CHECK (no_price >= 0 AND no_price <= 1),
  volume_24h NUMERIC(20,2) DEFAULT 0,
  open_interest NUMERIC(20,2),
  liquidity NUMERIC(20,2),
  spread NUMERIC(8,6),
  status market_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolution resolution_outcome,
  resolved_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_snapshot_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  platform_raw JSONB,
  CONSTRAINT markets_price_sum_check CHECK (ABS((yes_price + no_price) - 1.0) < 0.001),
  CONSTRAINT markets_unique_platform_platform_id UNIQUE(platform, platform_id)
);

CREATE INDEX idx_markets_platform ON markets(platform);
CREATE INDEX idx_markets_category ON markets(category);
CREATE INDEX idx_markets_status ON markets(status);
CREATE INDEX idx_markets_closes_at ON markets(closes_at) WHERE resolved = FALSE;
CREATE INDEX idx_markets_event_id ON markets(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX idx_markets_last_snapshot_at ON markets(last_snapshot_at) WHERE is_active = TRUE;
CREATE INDEX idx_markets_is_active ON markets(is_active);

CREATE TABLE market_snapshots (
  id BIGSERIAL PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  snapshot_time TIMESTAMPTZ NOT NULL,
  yes_price NUMERIC(8,6) NOT NULL CHECK (yes_price >= 0 AND yes_price <= 1),
  no_price NUMERIC(8,6) NOT NULL CHECK (no_price >= 0 AND no_price <= 1),
  volume_24h NUMERIC(20,2),
  open_interest NUMERIC(20,2),
  liquidity NUMERIC(20,2),
  spread NUMERIC(8,6),
  source TEXT NOT NULL,
  fetch_latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT market_snapshots_price_sum_check CHECK (ABS((yes_price + no_price) - 1.0) < 0.001),
  CONSTRAINT market_snapshots_market_id_snapshot_time_key UNIQUE(market_id, snapshot_time)
);

CREATE INDEX idx_snapshots_market_time ON market_snapshots(market_id, snapshot_time DESC);
CREATE INDEX idx_snapshots_snapshot_time ON market_snapshots(snapshot_time DESC);
CREATE INDEX idx_snapshots_source ON market_snapshots(source);

CREATE TABLE market_resolutions (
  id BIGSERIAL PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  outcome resolution_outcome NOT NULL,
  resolved_at TIMESTAMPTZ NOT NULL,
  final_yes_price NUMERIC(8,6),
  resolution_source TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT market_resolutions_market_id_key UNIQUE(market_id)
);

CREATE TABLE ingestion_runs (
  id BIGSERIAL PRIMARY KEY,
  run_type TEXT NOT NULL,
  job_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  kalshi_markets_fetched INTEGER DEFAULT 0,
  kalshi_markets_new INTEGER DEFAULT 0,
  kalshi_snapshots_written INTEGER DEFAULT 0,
  kalshi_errors INTEGER DEFAULT 0,
  kalshi_available BOOLEAN DEFAULT TRUE,
  kalshi_fetch_ms INTEGER,
  polymarket_markets_fetched INTEGER DEFAULT 0,
  polymarket_markets_new INTEGER DEFAULT 0,
  polymarket_snapshots_written INTEGER DEFAULT 0,
  polymarket_errors INTEGER DEFAULT 0,
  polymarket_available BOOLEAN DEFAULT TRUE,
  polymarket_fetch_ms INTEGER,
  resolutions_detected INTEGER DEFAULT 0,
  errors JSONB,
  status ingestion_status NOT NULL DEFAULT 'running',
  notes TEXT
);

CREATE INDEX idx_ingestion_runs_started_at ON ingestion_runs(started_at DESC);
CREATE INDEX idx_ingestion_runs_status ON ingestion_runs(status);
CREATE INDEX idx_ingestion_runs_run_type ON ingestion_runs(run_type);

CREATE TABLE source_health (
  source TEXT PRIMARY KEY,
  is_available BOOLEAN NOT NULL,
  last_successful_fetch TIMESTAMPTZ,
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  market_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO source_health (source, is_available)
VALUES ('kalshi', TRUE), ('polymarket', TRUE);
