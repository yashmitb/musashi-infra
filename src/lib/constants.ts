/**
 * Central repository for all string constants used across the codebase.
 * This prevents typos and makes refactoring easier.
 */

// Job Types
export const JOB_TYPES = {
  FULL_SYNC: 'full_sync',
  CRAWL_ADVANCE: 'crawl_advance',
  RESOLUTION_CHECK: 'resolution_check',
  RESOLUTION_BACKFILL: 'resolution_backfill',
  GAP_DETECTION: 'gap_detection',
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

// Checkpoint Keys
export const CHECKPOINT_KEYS = {
  KALSHI_FULL_SYNC: 'kalshi_full_sync',
  KALSHI_CRAWL_ADVANCE: 'kalshi_crawl_advance',
} as const;

export type CheckpointKey = (typeof CHECKPOINT_KEYS)[keyof typeof CHECKPOINT_KEYS];

// Source Names
export const SOURCE_NAMES = {
  KALSHI_API_V2: 'kalshi_api_v2',
  POLYMARKET_API: 'polymarket_api',
} as const;

export type SourceName = (typeof SOURCE_NAMES)[keyof typeof SOURCE_NAMES];

// Database Tables
export const DB_TABLES = {
  MARKETS: 'markets',
  MARKETS_ARCHIVE: 'markets_archive',
  MARKET_SNAPSHOTS: 'market_snapshots',
  MARKET_RESOLUTIONS: 'market_resolutions',
  INGESTION_RUNS: 'ingestion_runs',
  SYNC_CHECKPOINTS: 'sync_checkpoints',
  SOURCE_HEALTH: 'source_health',
} as const;

export type DbTable = (typeof DB_TABLES)[keyof typeof DB_TABLES];

// Batch Sizes
export const BATCH_SIZES = {
  DB_BATCH: 200,
  MARKET_PRUNE: 1000,
  MARKET_ARCHIVE: 1000,
} as const;

// Max Iterations for Loops
export const MAX_ITERATIONS = {
  DB_RECONCILIATION: 1000,
  SCRIPT_OPERATIONS: 10000,
} as const;
