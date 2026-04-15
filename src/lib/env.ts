import { z } from 'zod';

// Zod schema for environment configuration with proper validation
const MusashiEnvSchema = z.object({
  kalshiBaseUrl: z.string().url().default('https://api.elections.kalshi.com/trade-api/v2'),
  supabaseUrl: z.string().url().nullable().optional().default(null),
  supabaseServiceKey: z.string().nullable().optional().default(null),
  fullSyncPageSize: z.coerce.number().int().positive().default(1000),
  fullSyncPageBudget: z.coerce.number().int().positive().default(10),
  fullSyncAbsoluteMaxPages: z.coerce.number().int().positive().default(1000),
  fullSyncProgressEveryPages: z.coerce.number().int().positive().default(1),
  resolutionCheckMaxMarkets: z.coerce.number().int().positive().default(200),
  resolutionCheckProgressEveryMarkets: z.coerce.number().int().positive().default(25),
  resolutionCheckFetchConcurrency: z.coerce.number().int().positive().default(2),
  resolutionCheckWorkerRateLimitMs: z.coerce.number().int().nonnegative().default(250),
  resolutionBackfillMaxRuns: z.coerce.number().int().positive().default(3),
  resolutionBackfillMaxDurationMs: z.coerce.number().int().positive().default(900000),
  resolutionBackfillMaxMarkets: z.coerce.number().int().positive().default(400),
  resolutionBackfillFetchConcurrency: z.coerce.number().int().positive().default(3),
  resolutionBackfillWorkerRateLimitMs: z.coerce.number().int().nonnegative().default(200),
  gapDetectionMaxMarkets: z.coerce.number().int().positive().default(500),
  gapDetectionProgressEveryMarkets: z.coerce.number().int().positive().default(25),
  crawlAdvanceMaxRuns: z.coerce.number().int().positive().default(5),
  crawlAdvanceMaxDurationMs: z.coerce.number().int().positive().default(900000),
  collectionStallMaxMinutes: z.coerce.number().int().positive().default(180),
  collectionRunMaxAgeMinutes: z.coerce.number().int().positive().default(30),
  snapshotCandidateLimit: z.coerce.number().int().positive().default(1000),
  snapshotActiveWindowHours: z.coerce.number().int().positive().default(24),
  snapshotMinVolume24h: z.coerce.number().nonnegative().default(1000),
  snapshotMinLiquidity: z.coerce.number().nonnegative().default(1000),
});

export type MusashiEnv = z.infer<typeof MusashiEnvSchema>;

export function getEnv(): MusashiEnv {
  const rawEnv = {
    kalshiBaseUrl: process.env.KALSHI_BASE_URL,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY,
    fullSyncPageSize: process.env.FULL_SYNC_PAGE_SIZE,
    fullSyncPageBudget: process.env.FULL_SYNC_PAGE_BUDGET,
    fullSyncAbsoluteMaxPages: process.env.FULL_SYNC_ABSOLUTE_MAX_PAGES,
    fullSyncProgressEveryPages: process.env.FULL_SYNC_PROGRESS_EVERY_PAGES,
    resolutionCheckMaxMarkets: process.env.RESOLUTION_CHECK_MAX_MARKETS,
    resolutionCheckProgressEveryMarkets: process.env.RESOLUTION_CHECK_PROGRESS_EVERY_MARKETS,
    resolutionCheckFetchConcurrency: process.env.RESOLUTION_CHECK_FETCH_CONCURRENCY,
    resolutionCheckWorkerRateLimitMs: process.env.RESOLUTION_CHECK_WORKER_RATE_LIMIT_MS,
    resolutionBackfillMaxRuns: process.env.RESOLUTION_BACKFILL_MAX_RUNS,
    resolutionBackfillMaxDurationMs: process.env.RESOLUTION_BACKFILL_MAX_DURATION_MS,
    resolutionBackfillMaxMarkets: process.env.RESOLUTION_BACKFILL_MAX_MARKETS,
    resolutionBackfillFetchConcurrency: process.env.RESOLUTION_BACKFILL_FETCH_CONCURRENCY,
    resolutionBackfillWorkerRateLimitMs: process.env.RESOLUTION_BACKFILL_WORKER_RATE_LIMIT_MS,
    gapDetectionMaxMarkets: process.env.GAP_DETECTION_MAX_MARKETS,
    gapDetectionProgressEveryMarkets: process.env.GAP_DETECTION_PROGRESS_EVERY_MARKETS,
    crawlAdvanceMaxRuns: process.env.CRAWL_ADVANCE_MAX_RUNS,
    crawlAdvanceMaxDurationMs: process.env.CRAWL_ADVANCE_MAX_DURATION_MS,
    collectionStallMaxMinutes: process.env.COLLECTION_STALL_MAX_MINUTES,
    collectionRunMaxAgeMinutes: process.env.COLLECTION_RUN_MAX_AGE_MINUTES,
    snapshotCandidateLimit: process.env.SNAPSHOT_CANDIDATE_LIMIT,
    snapshotActiveWindowHours: process.env.SNAPSHOT_ACTIVE_WINDOW_HOURS,
    snapshotMinVolume24h: process.env.SNAPSHOT_MIN_VOLUME_24H,
    snapshotMinLiquidity: process.env.SNAPSHOT_MIN_LIQUIDITY,
  };

  const result = MusashiEnvSchema.safeParse(rawEnv);

  if (!result.success) {
    throw new Error(
      `Invalid environment configuration: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ')}`
    );
  }

  return result.data;
}

const SupabaseEnvSchema = z.object({
  supabaseUrl: z.string().url(),
  supabaseServiceKey: z.string().min(1),
});

export function getSupabaseEnv(): { supabaseUrl: string; supabaseServiceKey: string } {
  const result = SupabaseEnvSchema.safeParse({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY,
  });

  if (!result.success) {
    throw new Error(
      `Missing or invalid required Supabase environment variables: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ')}`
    );
  }

  return result.data;
}
