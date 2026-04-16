ALTER TABLE markets
ADD COLUMN IF NOT EXISTS settles_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_markets_settles_at
ON markets(settles_at)
WHERE resolved = FALSE;

ALTER TABLE markets_archive
ADD COLUMN IF NOT EXISTS settles_at TIMESTAMPTZ;
