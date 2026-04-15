# Runbook: Resolution-Check and Gap-Detection Jobs

## Overview

These two jobs are maintenance jobs that run independently of the main crawl. They operate on markets already in the database and require live Kalshi API access.

| Job | Command | What it does |
|---|---|---|
| `resolution-check` | `npm run job:resolution-check` | Finds closed-but-unresolved markets, fetches their settlement status from Kalshi, and writes the result |
| `gap-detection` | `npm run job:gap-detection` | Finds active markets with no recent price snapshot and backfills one |

---

## resolution-check

### What it does

1. Queries `markets` where `resolved = false` AND `closes_at <= now` (up to `RESOLUTION_CHECK_MAX_MARKETS`, default 500)
2. For each Kalshi market, calls `/markets/{ticker}` to get current status
3. If `status == 'settled'` and `result == 'yes'|'no'`:
   - Inserts a row into `market_resolutions`
   - Updates `markets` to set `resolved = true`, `status = 'resolved'`, `resolution = 'YES'|'NO'`
4. Skips markets with any other outcome (e.g. `void`) — these are not written

### Normal output

```json
{
  "status": "success",
  "notes": "Checked 42 Kalshi markets and detected 3 resolutions.",
  "kalshi_markets_fetched": 42,
  "resolutions_detected": 3,
  "kalshi_errors": 0
}
```

### Partial output (some per-market errors)

```json
{
  "status": "partial",
  "notes": "Checked 42 Kalshi markets and detected 3 resolutions (2 per-market errors).",
  "kalshi_errors": 2,
  "errors": [
    { "error_type": "resolution_check_market_failed", "error_message": "TICKER-X: connection timeout" }
  ]
}
```

### Failure (fatal outer error)

```json
{
  "status": "failed",
  "kalshi_available": false,
  "errors": [{ "error_type": "resolution_check_failed", "error_message": "..." }]
}
```

### How to verify it worked

```sql
-- Markets resolved in the last hour
SELECT market_id, outcome, detected_at
FROM market_resolutions
WHERE detected_at > now() - interval '1 hour'
ORDER BY detected_at DESC;

-- Confirm markets table was updated
SELECT id, status, resolved, resolution, resolved_at
FROM markets
WHERE resolved = true
ORDER BY resolved_at DESC
LIMIT 20;
```

### Knobs

| Env var | Default | Purpose |
|---|---|---|
| `RESOLUTION_CHECK_MAX_MARKETS` | 500 | Max candidates per run |
| `RESOLUTION_CHECK_PROGRESS_EVERY_MARKETS` | 25 | How often to write progress to `ingestion_runs` |

---

## gap-detection

### What it does

1. Queries active markets where `last_snapshot_at IS NULL OR last_snapshot_at < now - 2h` (up to `GAP_DETECTION_MAX_MARKETS`, default 500)
2. Skips markets whose `last_snapshot_at` is older than 24h (likely inactive/stale)
3. For each remaining market, calls `/markets/{ticker}` to get current price
4. Batches results and writes snapshots to `market_snapshots` (idempotent — deduped by `market_id, snapshot_time`)
5. Updates `last_snapshot_at` on the `markets` row

### Normal output

```json
{
  "status": "success",
  "notes": "Detected 15 gap candidates and backfilled 12 snapshots.",
  "kalshi_markets_fetched": 12,
  "kalshi_snapshots_written": 12
}
```

> Note: `candidates` may be > `markets_fetched` because markets older than 24h are skipped before the API call.

### How to verify it worked

```sql
-- Snapshots written in the last hour
SELECT market_id, snapshot_time, source
FROM market_snapshots
WHERE snapshot_time > now() - interval '1 hour'
ORDER BY snapshot_time DESC
LIMIT 20;

-- Markets with very stale snapshots (should be empty after a healthy run)
SELECT id, platform_id, last_snapshot_at
FROM markets
WHERE is_active = true
  AND (last_snapshot_at IS NULL OR last_snapshot_at < now() - interval '3 hours')
ORDER BY last_snapshot_at ASC NULLS FIRST
LIMIT 20;
```

### Knobs

| Env var | Default | Purpose |
|---|---|---|
| `GAP_DETECTION_MAX_MARKETS` | 500 | Max candidates per run |
| `GAP_DETECTION_PROGRESS_EVERY_MARKETS` | 25 | How often to write progress to `ingestion_runs` |

---

## Shared: Ingestion run log

Both jobs write to `ingestion_runs`. Query recent runs:

```sql
SELECT run_type, status, started_at, duration_ms, notes, errors
FROM ingestion_runs
WHERE run_type IN ('resolution_check', 'gap_detection')
ORDER BY started_at DESC
LIMIT 10;
```

A `status` of `partial` means some markets failed but the job completed — check the `errors` column for per-ticker details. A `status` of `failed` means a fatal error occurred before the job could finish.

---

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| `status: failed` + `kalshi_available: false` | Kalshi API unreachable | Check Kalshi status; re-run when available |
| High `kalshi_errors` count | Intermittent API timeouts | Acceptable if < 5%; check `errors` column for pattern |
| `resolutions_detected: 0` when markets should be settling | Markets not yet settled on Kalshi | Normal; they settle on Kalshi's schedule |
| `kalshi_snapshots_written: 0` + many candidates | All candidates older than 24h window | Check for inactive markets clogging the candidate query |
| Job crashes before completing | Fatal DB error | Check Supabase health; re-run will call `failOpenRuns` to clean up the stuck run |
