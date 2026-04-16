import { createClient } from '@supabase/supabase-js';
import { summarizeJobHealth, type JobSummaryRun } from '../src/lib/job-health.js';
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
const [steadyRunsResult, backfillRunsResult, unresolvedResult, resolutionCountResult] = await Promise.all([
  supabase
    .from('ingestion_runs')
    .select(
      'started_at,completed_at,status,kalshi_markets_fetched,kalshi_snapshots_written,resolutions_detected,errors'
    )
    .eq('run_type', 'resolution_check')
    .order('started_at', { ascending: false })
    .limit(12),
  supabase
    .from('ingestion_runs')
    .select(
      'started_at,completed_at,status,kalshi_markets_fetched,kalshi_snapshots_written,resolutions_detected,errors'
    )
    .eq('run_type', 'resolution_backfill')
    .order('started_at', { ascending: false })
    .limit(12),
  supabase
    .from('markets')
    .select('id', { count: 'estimated', head: true })
    .eq('resolved', false)
    .or(`settles_at.lte.${nowIso},and(settles_at.is.null,closes_at.lte.${nowIso})`),
  supabase.from('market_resolutions').select('id', { count: 'estimated', head: true }),
]);

const mapRuns = (runs: Array<Record<string, unknown>> = []): JobSummaryRun[] =>
  runs.map((run) => ({
    started_at: String(run.started_at ?? ''),
    completed_at: typeof run.completed_at === 'string' ? run.completed_at : null,
    status: String(run.status ?? ''),
    kalshi_markets_fetched: Number(run.kalshi_markets_fetched ?? 0),
    kalshi_snapshots_written: Number(run.kalshi_snapshots_written ?? 0),
    resolutions_detected: Number(run.resolutions_detected ?? 0),
    error_types: Array.isArray(run.errors)
      ? run.errors.map((error) =>
          typeof error === 'object' && error !== null && 'error_type' in error ? String(error.error_type) : 'unknown'
        )
      : [],
  }));

console.log(
  JSON.stringify(
    {
      unresolved_past_close_count: unresolvedResult.count,
      total_resolutions: resolutionCountResult.count,
      steady_state_health: summarizeJobHealth(mapRuns(steadyRunsResult.data ?? [])),
      backfill_health: summarizeJobHealth(mapRuns(backfillRunsResult.data ?? [])),
    },
    null,
    2
  )
);
