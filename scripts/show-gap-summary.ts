import { createClient } from '@supabase/supabase-js';
import { getEnv } from '../src/lib/env.js';
import { summarizeJobHealth } from '../src/lib/job-health.js';
import { loadRuntimeEnv } from '../src/lib/runtime-env.js';

const env = await loadRuntimeEnv(new URL('../.env', import.meta.url));

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
}

for (const [key, value] of Object.entries(env)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

const runtime = getEnv();

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const threshold = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
const activeWindowIso = new Date(Date.now() + runtime.snapshotActiveWindowHours * 60 * 60 * 1000).toISOString();

const [runsResult, gapCountResult] = await Promise.all([
  supabase
    .from('ingestion_runs')
    .select('started_at,completed_at,status,kalshi_markets_fetched,kalshi_snapshots_written,resolutions_detected,errors')
    .eq('run_type', 'gap_detection')
    .order('started_at', { ascending: false })
    .limit(12),
  supabase
    .from('markets')
    .select('id', { count: 'estimated', head: true })
    .eq('is_active', true)
    .eq('resolved', false)
    .or(
      `closes_at.lte.${activeWindowIso},volume_24h.gte.${runtime.snapshotMinVolume24h},liquidity.gte.${runtime.snapshotMinLiquidity}`,
    )
    .or(`last_snapshot_at.is.null,last_snapshot_at.lt.${threshold}`),
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
      current_active_gap_candidate_count: gapCountResult.count,
      snapshot_policy: {
        active_window_hours: runtime.snapshotActiveWindowHours,
        min_volume_24h: runtime.snapshotMinVolume24h,
        min_liquidity: runtime.snapshotMinLiquidity,
      },
      job_health: summarizeJobHealth(runs),
    },
    null,
    2,
  ),
);
