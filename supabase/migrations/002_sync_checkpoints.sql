CREATE TABLE sync_checkpoints (
  checkpoint_key TEXT PRIMARY KEY,
  run_type TEXT NOT NULL,
  cursor TEXT,
  page_count INTEGER NOT NULL DEFAULT 0,
  market_count INTEGER NOT NULL DEFAULT 0,
  snapshot_time TIMESTAMPTZ,
  job_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sync_checkpoints_run_type ON sync_checkpoints(run_type);
