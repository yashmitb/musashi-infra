import { createClient } from '@supabase/supabase-js';
import { summarizeJobHealth } from '../src/lib/job-health.js';
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

const nowIso = new Date().toISOString();
const [runsResult, unresolvedResult, resolutionCountResult] = await Promise.all([
  supabase
    .from('ingestion_runs')
    .select('started_at,completed_at,status,kalshi_markets_fetched,kalshi_snapshots_written,resolutions_detected,errors')
    .eq('run_type', 'resolution_check')
    .order('started_at', { ascending: false })
    .limit(12),
  supabase
    .from('markets')
    .select('id', { count: 'estimated', head: true })
    .eq('resolved', false)
    .lte('closes_at', nowIso),
  supabase.from('market_resolutions').select('id', { count: 'estimated', head: true }),
]);

const runs = (runsResult.data ?? []).map((run) => ({
  started_at: run.started_at,
  completed_at: run.completed_at,
  status: run.status,
  kalshi_markets_fetched: run.kalshi_markets_fetched,
  kalshi_snapshots_written: run.kalshi_snapshots_written,
  resolutions_detected: run.resolutions_detected,
  error_types: Array.isArray(run.errors) ? run.errors.map((error) => error.error_type) : [],
}));

console.log(
  JSON.stringify(
    {
      unresolved_past_close_count: unresolvedResult.count,
      total_resolutions: resolutionCountResult.count,
      job_health: summarizeJobHealth(runs),
    },
    null,
    2,
  ),
);
