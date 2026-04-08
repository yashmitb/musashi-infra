import { createClient } from '@supabase/supabase-js';
import { summarizeCrawlProgress } from '../src/lib/crawl-progress.js';
import { loadRuntimeEnv } from '../src/lib/runtime-env.js';

const env = await loadRuntimeEnv(new URL('../.env', import.meta.url));

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const [checkpointResult, runsResult] = await Promise.all([
  supabase.from('sync_checkpoints').select('*').eq('checkpoint_key', 'kalshi_full_sync').maybeSingle(),
  supabase
    .from('ingestion_runs')
    .select('started_at,completed_at,duration_ms,kalshi_markets_new,kalshi_snapshots_written,status,errors')
    .eq('run_type', 'full_sync')
    .order('started_at', { ascending: false })
    .limit(10),
]);

const checkpoint = checkpointResult.data;
const runs = runsResult.data ?? [];

const summary = summarizeCrawlProgress({
  checkpoint: checkpoint
    ? {
        updated_at: checkpoint.updated_at,
        market_count: checkpoint.market_count,
        page_count: checkpoint.page_count,
      }
    : null,
  recentRuns: runs.map((run) => ({
    started_at: run.started_at,
    completed_at: run.completed_at,
    duration_ms: run.duration_ms,
    kalshi_markets_new: run.kalshi_markets_new,
    kalshi_snapshots_written: run.kalshi_snapshots_written,
    status: run.status,
    error_types: Array.isArray(run.errors) ? run.errors.map((error) => error.error_type) : [],
  })),
});

console.log(JSON.stringify(summary, null, 2));
