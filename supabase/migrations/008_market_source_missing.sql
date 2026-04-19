ALTER TABLE markets
ADD COLUMN IF NOT EXISTS source_missing_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_markets_source_missing_at
ON markets(source_missing_at)
WHERE source_missing_at IS NOT NULL;

ALTER TABLE markets_archive
ADD COLUMN IF NOT EXISTS source_missing_at TIMESTAMPTZ;
