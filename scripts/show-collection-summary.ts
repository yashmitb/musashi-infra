import { createClient } from '@supabase/supabase-js';
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

const [checkpointResult, healthResult, runsResult] = await Promise.all([
  supabase.from('sync_checkpoints').select('*').eq('checkpoint_key', 'kalshi_full_sync').maybeSingle(),
  supabase.from('source_health').select('*').eq('source', 'kalshi').maybeSingle(),
  supabase
    .from('ingestion_runs')
    .select('started_at,status,kalshi_markets_fetched,kalshi_markets_new,kalshi_snapshots_written,errors,notes')
    .eq('run_type', 'full_sync')
    .order('started_at', { ascending: false })
    .limit(3),
]);

const checkpoint = checkpointResult.data;
const health = healthResult.data;
const runs = runsResult.data ?? [];

console.log(
  JSON.stringify(
    {
      checkpoint: checkpoint
        ? {
            page_count: checkpoint.page_count,
            market_count: checkpoint.market_count,
            updated_at: checkpoint.updated_at,
          }
        : null,
      kalshi_health: health
        ? {
            is_available: health.is_available,
            market_count: health.market_count,
            last_successful_fetch: health.last_successful_fetch,
            last_error: health.last_error,
          }
        : null,
      recent_runs: runs.map((run) => ({
        started_at: run.started_at,
        status: run.status,
        kalshi_markets_fetched: run.kalshi_markets_fetched,
        kalshi_markets_new: run.kalshi_markets_new,
        kalshi_snapshots_written: run.kalshi_snapshots_written,
        error_types: Array.isArray(run.errors) ? run.errors.map((error) => error.error_type) : [],
        notes: run.notes,
      })),
    },
    null,
    2,
  ),
);
