function readRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export interface MusashiEnv {
  kalshiBaseUrl: string;
  supabaseUrl: string | null;
  supabaseServiceKey: string | null;
  fullSyncPageSize: number;
  fullSyncPageBudget: number;
  fullSyncAbsoluteMaxPages: number;
  fullSyncProgressEveryPages: number;
  resolutionCheckMaxMarkets: number;
  resolutionCheckProgressEveryMarkets: number;
  gapDetectionMaxMarkets: number;
  gapDetectionProgressEveryMarkets: number;
  crawlAdvanceMaxRuns: number;
  crawlAdvanceMaxDurationMs: number;
  collectionStallMaxMinutes: number;
  collectionRunMaxAgeMinutes: number;
}

export function getEnv(): MusashiEnv {
  return {
    kalshiBaseUrl: process.env.KALSHI_BASE_URL ?? 'https://api.elections.kalshi.com/trade-api/v2',
    supabaseUrl: process.env.SUPABASE_URL ?? null,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY ?? null,
    fullSyncPageSize: Number(process.env.FULL_SYNC_PAGE_SIZE ?? '1000'),
    fullSyncPageBudget: Number(process.env.FULL_SYNC_PAGE_BUDGET ?? '10'),
    fullSyncAbsoluteMaxPages: Number(process.env.FULL_SYNC_ABSOLUTE_MAX_PAGES ?? '1000'),
    fullSyncProgressEveryPages: Number(process.env.FULL_SYNC_PROGRESS_EVERY_PAGES ?? '1'),
    resolutionCheckMaxMarkets: Number(process.env.RESOLUTION_CHECK_MAX_MARKETS ?? '500'),
    resolutionCheckProgressEveryMarkets: Number(process.env.RESOLUTION_CHECK_PROGRESS_EVERY_MARKETS ?? '25'),
    gapDetectionMaxMarkets: Number(process.env.GAP_DETECTION_MAX_MARKETS ?? '500'),
    gapDetectionProgressEveryMarkets: Number(process.env.GAP_DETECTION_PROGRESS_EVERY_MARKETS ?? '25'),
    crawlAdvanceMaxRuns: Number(process.env.CRAWL_ADVANCE_MAX_RUNS ?? '5'),
    crawlAdvanceMaxDurationMs: Number(process.env.CRAWL_ADVANCE_MAX_DURATION_MS ?? '900000'),
    collectionStallMaxMinutes: Number(process.env.COLLECTION_STALL_MAX_MINUTES ?? '180'),
    collectionRunMaxAgeMinutes: Number(process.env.COLLECTION_RUN_MAX_AGE_MINUTES ?? '30'),
  };
}

export function getSupabaseEnv(): { supabaseUrl: string; supabaseServiceKey: string } {
  return {
    supabaseUrl: readRequiredEnv('SUPABASE_URL'),
    supabaseServiceKey: readRequiredEnv('SUPABASE_SERVICE_KEY'),
  };
}
