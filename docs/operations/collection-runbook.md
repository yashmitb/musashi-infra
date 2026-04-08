# Collection Runbook

## Purpose

The collection system advances the Kalshi crawl in bounded runs and resumes from `sync_checkpoints` until the exchange crawl completes.

## Primary Entry Points

- Scheduled collection: `.github/workflows/full-sync.yml`
- Scheduled health check: `.github/workflows/collection-health.yml`
- Manual bounded crawl: `npm run job:crawl-advance`
- Single bounded sync: `npm run job:full-sync`
- Status inspection: `npm run status:sync`
- Summary inspection: `npm run status:collection`
- Failing health check: `npm run check:collection`

## How Collection Progress Works

1. `job:crawl-advance` chains multiple bounded `job:full-sync` runs.
2. Each `job:full-sync` run processes up to `FULL_SYNC_PAGE_BUDGET` pages.
3. Each page is normalized and written before the next page is fetched.
4. Progress is persisted to `sync_checkpoints`.
5. Later runs resume from the saved cursor.

## Important Environment Knobs

- `FULL_SYNC_PAGE_SIZE`
- `FULL_SYNC_PAGE_BUDGET`
- `FULL_SYNC_ABSOLUTE_MAX_PAGES`
- `CRAWL_ADVANCE_MAX_RUNS`
- `CRAWL_ADVANCE_MAX_DURATION_MS`

## What Healthy Collection Looks Like

- `source_health.kalshi.is_available = true`
- `sync_checkpoints.market_count` keeps increasing
- recent `ingestion_runs` show `status = partial` with `error_type = page_budget_exhausted`
- `market_snapshots` count keeps increasing

## What Needs Investigation

- `source_health.kalshi.is_available = false`
- recent `ingestion_runs` show `error_type = source_unavailable`
- `sync_checkpoints` stops moving across multiple scheduled runs
- `cursor_loop_detected`
- `npm run check:collection` exits non-zero

## Tables To Check

- `markets`
- `market_snapshots`
- `ingestion_runs`
- `sync_checkpoints`
- `source_health`
