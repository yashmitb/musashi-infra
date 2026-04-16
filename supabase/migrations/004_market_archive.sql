CREATE TABLE IF NOT EXISTS markets_archive (
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
  status market_status NOT NULL DEFAULT 'closed',
  created_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolution resolution_outcome,
  resolved_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ,
  last_ingested_at TIMESTAMPTZ,
  last_snapshot_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archive_reason TEXT NOT NULL,
  CONSTRAINT markets_archive_price_sum_check CHECK (ABS((yes_price + no_price) - 1.0) < 0.001)
);

CREATE INDEX IF NOT EXISTS idx_markets_archive_platform ON markets_archive(platform);
CREATE INDEX IF NOT EXISTS idx_markets_archive_status ON markets_archive(status);
CREATE INDEX IF NOT EXISTS idx_markets_archive_archived_at ON markets_archive(archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_markets_archive_event_id ON markets_archive(event_id) WHERE event_id IS NOT NULL;
