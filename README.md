# musashi-infra

Kalshi-first data infrastructure for Musashi.

## Scope

This repository owns Stage 0 of the Musashi platform:

- canonical market types
- Kalshi ingestion client
- normalization
- durable storage schema
- snapshot and resolution jobs
- health and freshness metadata

It does not own product APIs, MCP distribution, UI, or intelligence features. Those layers consume this repository's outputs.

## Principles

- log before analyze
- storage-first, not cache-first
- direct Kalshi source of truth
- public Kalshi market data via `api.elections.kalshi.com`
- idempotent writes everywhere
- explicit invariants at the database boundary
- Kalshi depth before multi-platform breadth

## Initial Layout

```text
docs/                 architecture and ADRs
src/api/              source clients and normalization
src/db/               storage access layer
src/jobs/             scheduled ingestion jobs
src/types/            canonical and raw types
src/lib/              shared helpers
scripts/              operational entrypoints
supabase/migrations/  durable schema
test/                 unit and contract tests
```

## Local Setup

1. Copy `.env.example` to `.env`
2. Fill in:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - optionally `KALSHI_BASE_URL`
3. Run:

```bash
npm install
npm run doctor
npm run typecheck
npm test
```

Core local commands:

```bash
npm run job:crawl-advance
npm run job:resolution-check
npm run job:resolution-backfill
npm run job:gap-detection
npm run status:collection
npm run status:crawl
npm run status:resolution
npm run status:gap
```

## GitHub Actions Secrets

Set these under repository `Settings` -> `Secrets and variables` -> `Actions` -> `Repository secrets`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- optional: `KALSHI_BASE_URL`

GitHub Actions now runs an explicit env preflight before each scheduled job, so missing secrets fail with a short setup error instead of a runtime stack trace.

## Operational Knobs

- `FULL_SYNC_PAGE_SIZE`
- `FULL_SYNC_PAGE_BUDGET`
- `FULL_SYNC_ABSOLUTE_MAX_PAGES`
- `FULL_SYNC_PROGRESS_EVERY_PAGES`
- `CRAWL_ADVANCE_MAX_RUNS`
- `CRAWL_ADVANCE_MAX_DURATION_MS`
- `RESOLUTION_CHECK_MAX_MARKETS`
- `RESOLUTION_BACKFILL_MAX_RUNS`
- `RESOLUTION_BACKFILL_MAX_DURATION_MS`
- `GAP_DETECTION_MAX_MARKETS`
- `SNAPSHOT_CANDIDATE_LIMIT`
- `SNAPSHOT_ACTIVE_WINDOW_HOURS`
- `SNAPSHOT_MIN_VOLUME_24H`
- `SNAPSHOT_MIN_LIQUIDITY`

## Collection Health
- `COLLECTION_STALL_MAX_MINUTES`
Threshold for detecting stalled collection runs
- `COLLECTION_RUN_MAX_AGE_MINUTES`
Maximum allowed age of last successful run


## Crawl Advance
- `FULL_SYNC_PAGE_BUDGET`
Number of pages processed per run
- `FULL_SYNC_ABSOLUTE_MAX_PAGES`
Hard cap on total pages processed
- `CRAWL_ADVANCE_MAX_RUNS`
Maximum iterations per execution
- `CRAWL_ADVANCE_MAX_DURATION_MS`
Maximum runtime duration


The full sync is designed to advance the exchange crawl in bounded runs. It resumes from `sync_checkpoints` until the crawl completes.

Use `npm run job:crawl-advance` when you want a single command to chain multiple bounded full-sync runs together without manually relaunching each one.

Use `npm run status:collection` for a short operational summary of checkpoint progress, Kalshi source health, and the most recent full-sync runs.

Use `npm run status:crawl` when you want a throughput-oriented view of the crawl, including recent markets-per-minute and snapshots-per-minute across bounded full-sync runs.

Use `npm run status:storage` when you want table counts and snapshot-growth proxies without opening Supabase usage pages.
If `SUPABASE_DB_HOST`, `SUPABASE_DB_NAME`, `SUPABASE_DB_USER`, and `SUPABASE_DB_PASSWORD` are set, it also reports real per-table storage size.

Use `npm run status:resolution` when you want to see whether settled markets are being detected and how many unresolved past-close markets remain.
It reports both the steady 5-minute resolution check and the larger backlog backfill runner.

Use `npm run status:gap` when you want to see current snapshot gap pressure and the recent health of the backfill job.

Use `npm run check:collection` when you want the process to fail if collection is stalled, unhealthy, or showing non-budget full-sync errors.
