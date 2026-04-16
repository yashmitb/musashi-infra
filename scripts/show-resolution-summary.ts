import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
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

const [steadyRunsResult, backfillRunsResult, settlesAtBackfillRunsResult, resolutionSummary] = await Promise.all([
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
    .from('ingestion_runs')
    .select(
      'started_at,completed_at,status,kalshi_markets_fetched,kalshi_snapshots_written,resolutions_detected,errors'
    )
    .eq('run_type', 'settles_at_backfill')
    .order('started_at', { ascending: false })
    .limit(12),
  loadResolutionSummary(),
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
      ...resolutionSummary,
      steady_state_health: summarizeJobHealth(mapRuns(steadyRunsResult.data ?? [])),
      backfill_health: summarizeJobHealth(mapRuns(backfillRunsResult.data ?? [])),
      settles_at_backfill_health: summarizeJobHealth(mapRuns(settlesAtBackfillRunsResult.data ?? [])),
    },
    null,
    2
  )
);

async function loadResolutionSummary(): Promise<{
  settlement_ready_unresolved_count: number | null;
  closed_waiting_settlement_count: number | null;
  missing_settles_at_backfill_count: number | null;
  open_past_close_unresolved_count: number | null;
  total_resolutions: number | null;
}> {
  if (env.SUPABASE_DB_HOST && env.SUPABASE_DB_NAME && env.SUPABASE_DB_USER && env.SUPABASE_DB_PASSWORD) {
    return loadResolutionSummaryFromDb();
  }

  const nowIso = new Date().toISOString();

  const [
    settlementReadyUnresolvedResult,
    closedWaitingSettlementResult,
    missingSettlesAtResult,
    openPastCloseResult,
    resolutionCountResult,
  ] = await Promise.all([
    supabase
      .from('markets')
      .select('id', { count: 'estimated', head: true })
      .eq('resolved', false)
      .or(`settles_at.lte.${nowIso},and(settles_at.is.null,closes_at.lte.${nowIso})`),
    supabase
      .from('markets')
      .select('id', { count: 'estimated', head: true })
      .eq('platform', 'kalshi')
      .eq('resolved', false)
      .eq('status', 'closed')
      .eq('is_active', false)
      .gt('settles_at', nowIso),
    supabase
      .from('markets')
      .select('id', { count: 'estimated', head: true })
      .eq('platform', 'kalshi')
      .eq('resolved', false)
      .eq('status', 'closed')
      .eq('is_active', false)
      .is('settles_at', null)
      .not('closes_at', 'is', null)
      .lte('closes_at', nowIso),
    supabase
      .from('markets')
      .select('id', { count: 'estimated', head: true })
      .eq('platform', 'kalshi')
      .eq('resolved', false)
      .eq('status', 'open')
      .not('closes_at', 'is', null)
      .lte('closes_at', nowIso),
    supabase.from('market_resolutions').select('id', { count: 'estimated', head: true }),
  ]);

  return {
    settlement_ready_unresolved_count: settlementReadyUnresolvedResult.count,
    closed_waiting_settlement_count: closedWaitingSettlementResult.count,
    missing_settles_at_backfill_count: missingSettlesAtResult.count,
    open_past_close_unresolved_count: openPastCloseResult.count,
    total_resolutions: resolutionCountResult.count,
  };
}

async function loadResolutionSummaryFromDb(): Promise<{
  settlement_ready_unresolved_count: number;
  closed_waiting_settlement_count: number;
  missing_settles_at_backfill_count: number;
  open_past_close_unresolved_count: number;
  total_resolutions: number;
}> {
  if (!env.SUPABASE_DB_HOST || !env.SUPABASE_DB_NAME || !env.SUPABASE_DB_USER || !env.SUPABASE_DB_PASSWORD) {
    throw new Error('Direct DB credentials are required to load the DB-backed resolution summary.');
  }

  const sql = postgres({
    host: env.SUPABASE_DB_HOST,
    port: Number(env.SUPABASE_DB_PORT ?? '5432'),
    database: env.SUPABASE_DB_NAME,
    username: env.SUPABASE_DB_USER,
    password: env.SUPABASE_DB_PASSWORD,
    ssl: 'require',
    max: 1,
  });

  try {
    const [row] = await sql<
      {
        settlement_ready_unresolved_count: string;
        closed_waiting_settlement_count: string;
        missing_settles_at_backfill_count: string;
        open_past_close_unresolved_count: string;
        total_resolutions: string;
      }[]
    >`
      select
        (select count(*)::bigint
           from markets
          where resolved = false
            and (
              settles_at <= now()
              or (settles_at is null and closes_at <= now())
            )) as settlement_ready_unresolved_count,
        (select count(*)::bigint
           from markets
          where platform = 'kalshi'
            and resolved = false
            and status = 'closed'
            and is_active = false
            and settles_at > now()) as closed_waiting_settlement_count,
        (select count(*)::bigint
           from markets
          where platform = 'kalshi'
            and resolved = false
            and status = 'closed'
            and is_active = false
            and settles_at is null
            and closes_at is not null
            and closes_at <= now()) as missing_settles_at_backfill_count,
        (select count(*)::bigint
           from markets
          where platform = 'kalshi'
            and resolved = false
            and status = 'open'
            and closes_at is not null
            and closes_at <= now()) as open_past_close_unresolved_count,
        (select count(*)::bigint
           from market_resolutions) as total_resolutions
    `;

    return {
      settlement_ready_unresolved_count: Number(row?.settlement_ready_unresolved_count ?? 0),
      closed_waiting_settlement_count: Number(row?.closed_waiting_settlement_count ?? 0),
      missing_settles_at_backfill_count: Number(row?.missing_settles_at_backfill_count ?? 0),
      open_past_close_unresolved_count: Number(row?.open_past_close_unresolved_count ?? 0),
      total_resolutions: Number(row?.total_resolutions ?? 0),
    };
  } finally {
    await sql.end();
  }
}
