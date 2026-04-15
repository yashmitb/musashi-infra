ALTER TABLE markets
ADD COLUMN IF NOT EXISTS is_compacted BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS compacted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_markets_compacted_at ON markets(compacted_at DESC) WHERE is_compacted = TRUE;
