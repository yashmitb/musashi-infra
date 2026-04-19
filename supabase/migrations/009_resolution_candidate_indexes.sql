CREATE INDEX IF NOT EXISTS idx_markets_resolution_terminal_settles_due
ON markets(settles_at)
WHERE resolved = FALSE
  AND source_missing_at IS NULL
  AND status IN ('closed', 'resolved')
  AND settles_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_markets_resolution_terminal_closes_due
ON markets(closes_at)
WHERE resolved = FALSE
  AND source_missing_at IS NULL
  AND status IN ('closed', 'resolved')
  AND settles_at IS NULL
  AND closes_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_markets_resolution_open_settles_due
ON markets(settles_at)
WHERE resolved = FALSE
  AND source_missing_at IS NULL
  AND status = 'open'
  AND settles_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_markets_resolution_open_closes_due
ON markets(closes_at)
WHERE resolved = FALSE
  AND source_missing_at IS NULL
  AND status = 'open'
  AND settles_at IS NULL
  AND closes_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_markets_settles_at_backfill_source_safe
ON markets(closes_at)
WHERE platform = 'kalshi'
  AND resolved = FALSE
  AND is_active = FALSE
  AND status = 'closed'
  AND source_missing_at IS NULL
  AND settles_at IS NULL
  AND closes_at IS NOT NULL;
