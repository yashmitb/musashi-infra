import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
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

const [marketCount, archiveCount, snapshotCount, resolutionCount, checkpointResult, runsResult, tableSizes, maintenance] = await Promise.all([
  countRows('markets'),
  countRows('markets_archive'),
  countRows('market_snapshots'),
  countRows('market_resolutions'),
  supabase.from('sync_checkpoints').select('page_count,market_count,updated_at').eq('checkpoint_key', 'kalshi_full_sync').maybeSingle(),
  supabase
    .from('ingestion_runs')
    .select('started_at,kalshi_snapshots_written,status')
    .eq('run_type', 'full_sync')
    .order('started_at', { ascending: false })
    .limit(12),
  loadTableSizes(),
  loadMaintenanceSummary(),
]);

const recentRuns = runsResult.data ?? [];
const recentSnapshotWrites = recentRuns.reduce((sum, run) => sum + (run.kalshi_snapshots_written ?? 0), 0);

console.log(
  JSON.stringify(
    {
      counts: {
        markets: marketCount,
        markets_archive: archiveCount,
        market_snapshots: snapshotCount,
        market_resolutions: resolutionCount,
      },
      recent_snapshot_writes: {
        last_12_full_sync_runs: recentSnapshotWrites,
      },
      table_sizes: tableSizes,
      maintenance,
      checkpoint: checkpointResult.data,
    },
    null,
    2,
  ),
);

async function countRows(table: string): Promise<number | null> {
  if (table === 'markets') {
    const estimatedResult = await supabase.from(table).select('id', { count: 'estimated', head: true });

    if (estimatedResult.error) {
      return null;
    }

    return estimatedResult.count;
  }

  if (table === 'markets_archive') {
    const estimatedResult = await supabase.from(table).select('id', { count: 'estimated', head: true });

    if (!estimatedResult.error) {
      return estimatedResult.count;
    }
  }

  const exactResult = await supabase.from(table).select('id', { count: 'exact', head: true });

  if (!exactResult.error) {
    return exactResult.count;
  }

  const estimatedResult = await supabase.from(table).select('id', { count: 'estimated', head: true });

  if (estimatedResult.error) {
    return null;
  }

  return estimatedResult.count;
}

async function loadTableSizes(): Promise<Array<{ table_name: string; total_size: string; bytes: number }> | null> {
  if (
    !env.SUPABASE_DB_HOST ||
    !env.SUPABASE_DB_NAME ||
    !env.SUPABASE_DB_USER ||
    !env.SUPABASE_DB_PASSWORD
  ) {
    return null;
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
    const rows = await sql.unsafe(`select relname as table_name,
                                          pg_size_pretty(pg_total_relation_size(oid)) as total_size,
                                          pg_total_relation_size(oid) as bytes
                                     from pg_class
                                    where relkind = 'r'
                                      and relnamespace = 'public'::regnamespace
                                    order by pg_total_relation_size(oid) desc
                                    limit 12`);

    return Array.from(rows as unknown as Array<{ table_name: string; total_size: string; bytes: number }>).map((row) => ({
      table_name: row.table_name,
      total_size: row.total_size,
      bytes: Number(row.bytes),
    }));
  } finally {
    await sql.end();
  }
}

async function loadMaintenanceSummary(): Promise<{
  prune_candidates_older_than_24h: number;
  compact_candidates_older_than_24h: number;
  compacted_rows: number;
  resolved_active_rows: number;
} | null> {
  if (
    !env.SUPABASE_DB_HOST ||
    !env.SUPABASE_DB_NAME ||
    !env.SUPABASE_DB_USER ||
    !env.SUPABASE_DB_PASSWORD
  ) {
    return null;
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
    const [pruneRows, compactRows, compactedRows, resolvedRows] = await Promise.all([
      sql.unsafe(`select count(*)::bigint as prune_candidates
                    from markets m
                   where m.platform = 'kalshi'
                     and m.status = 'closed'
                     and m.resolved = false
                     and m.is_active = false
                     and m.last_snapshot_at is null
                     and m.last_ingested_at < now() - interval '24 hours'
                     and not exists (select 1 from market_resolutions r where r.market_id = m.id)`),
      sql.unsafe(`select count(*)::bigint as compact_candidates
                    from markets m
                   where m.platform = 'kalshi'
                     and m.is_active = false
                     and m.status in ('closed', 'resolved')
                     and (
                       (m.status = 'closed' and m.closes_at < now() - interval '24 hours')
                       or (m.status = 'resolved' and coalesce(m.resolved_at, m.closes_at) < now() - interval '24 hours')
                     )
                     and m.is_compacted = false`),
      sql.unsafe(`select count(*)::bigint as compacted_rows
                    from markets
                   where platform = 'kalshi'
                     and is_compacted = true`),
      sql.unsafe(`select count(*)::bigint as resolved_active_rows
                    from markets
                   where platform = 'kalshi'
                     and status = 'resolved'
                     and resolved = true
                     and is_active = true`),
    ]);

    return {
      prune_candidates_older_than_24h: Number(
        (pruneRows as unknown as Array<{ prune_candidates: string }>)[0]?.prune_candidates ?? 0,
      ),
      compact_candidates_older_than_24h: Number(
        (compactRows as unknown as Array<{ compact_candidates: string }>)[0]?.compact_candidates ?? 0,
      ),
      compacted_rows: Number(
        (compactedRows as unknown as Array<{ compacted_rows: string }>)[0]?.compacted_rows ?? 0,
      ),
      resolved_active_rows: Number(
        (resolvedRows as unknown as Array<{ resolved_active_rows: string }>)[0]?.resolved_active_rows ?? 0,
      ),
    };
  } finally {
    await sql.end();
  }
}
