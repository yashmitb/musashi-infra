CREATE INDEX IF NOT EXISTS idx_markets_settles_at_backfill
ON markets(closes_at)
WHERE platform = 'kalshi'
  AND resolved = FALSE
  AND is_active = FALSE
  AND status = 'closed'
  AND settles_at IS NULL
  AND closes_at IS NOT NULL;
