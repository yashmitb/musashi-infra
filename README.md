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

## Operational Knobs

- `FULL_SYNC_PAGE_SIZE`
- `FULL_SYNC_PAGE_BUDGET`
- `FULL_SYNC_ABSOLUTE_MAX_PAGES`
- `FULL_SYNC_PROGRESS_EVERY_PAGES`
- `CRAWL_ADVANCE_MAX_RUNS`
- `CRAWL_ADVANCE_MAX_DURATION_MS`
- `RESOLUTION_CHECK_MAX_MARKETS`
- `GAP_DETECTION_MAX_MARKETS`

The full sync is designed to advance the exchange crawl in bounded runs. It resumes from `sync_checkpoints` until the crawl completes.

Use `npm run job:crawl-advance` when you want a single command to chain multiple bounded full-sync runs together without manually relaunching each one.
