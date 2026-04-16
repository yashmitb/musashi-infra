import { createClient } from '@supabase/supabase-js';

import { getEnv } from '../src/lib/env.js';
import { evaluateCollectionHealth } from '../src/lib/collection-health.js';
import { loadRuntimeEnv } from '../src/lib/runtime-env.js';

const parsedEnv = await loadRuntimeEnv(new URL('../.env', import.meta.url));

if (!parsedEnv.SUPABASE_URL || !parsedEnv.SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
}

const env = getEnv();
const now = new Date();

const supabase = createClient(parsedEnv.SUPABASE_URL, parsedEnv.SUPABASE_SERVICE_KEY, {
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
    .select('started_at,completed_at,status,errors')
    .eq('run_type', 'full_sync')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle(),
]);

const result = evaluateCollectionHealth({
  now,
  checkpoint: checkpointResult.data
    ? {
        updated_at: checkpointResult.data.updated_at,
        market_count: checkpointResult.data.market_count,
        page_count: checkpointResult.data.page_count,
      }
    : null,
  latestRun: runsResult.data
    ? {
        started_at: runsResult.data.started_at,
        completed_at: runsResult.data.completed_at,
        status: runsResult.data.status,
        error_types: Array.isArray(runsResult.data.errors)
          ? runsResult.data.errors.map((error) => String(error.error_type))
          : [],
      }
    : null,
  sourceHealth: healthResult.data
    ? {
        is_available: healthResult.data.is_available,
        last_successful_fetch: healthResult.data.last_successful_fetch,
        last_error: healthResult.data.last_error,
      }
    : null,
  stallMaxMinutes: env.collectionStallMaxMinutes,
  runMaxAgeMinutes: env.collectionRunMaxAgeMinutes,
});

console.log(
  JSON.stringify(
    {
      checked_at: now.toISOString(),
      healthy: result.healthy,
      reasons: result.reasons,
      checkpoint: checkpointResult.data,
      source_health: healthResult.data,
      latest_run: runsResult.data,
    },
    null,
    2
  )
);

if (!result.healthy) {
  process.exit(1);
}
