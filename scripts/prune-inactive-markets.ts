import postgres from 'postgres';

import { MAX_ITERATIONS } from '../src/lib/constants.js';
import { loadRuntimeEnv } from '../src/lib/runtime-env.js';

const env = await loadRuntimeEnv(new URL('../.env', import.meta.url));

const host = requireEnv('SUPABASE_DB_HOST');
const database = requireEnv('SUPABASE_DB_NAME');
const username = requireEnv('SUPABASE_DB_USER');
const password = requireEnv('SUPABASE_DB_PASSWORD');

const minAgeHours = Number(env.MARKET_PRUNE_MIN_AGE_HOURS ?? '24');
const batchSize = Number(env.MARKET_PRUNE_BATCH_SIZE ?? '1000');
const execute = env.MARKET_PRUNE_EXECUTE === 'true';
const cutoffIso = new Date(Date.now() - minAgeHours * 60 * 60 * 1000).toISOString();

const sql = postgres({
  host,
  port: Number(env.SUPABASE_DB_PORT ?? '5432'),
  database,
  username,
  password,
  ssl: 'require',
  max: 1,
});

try {
  const [pruneCandidateRow, resolvedActiveRow] = await Promise.all([
    sql<{ prune_candidates: string }[]>`select count(*)::bigint as prune_candidates
      from markets m
      where m.platform = 'kalshi'
        and m.status = 'closed'
        and m.resolved = false
        and m.is_active = false
        and m.last_snapshot_at is null
        and m.last_ingested_at < ${cutoffIso}
        and not exists (select 1 from market_resolutions r where r.market_id = m.id)`,
    sql<{ resolved_active_rows: string }[]>`select count(*)::bigint as resolved_active_rows
      from markets
      where platform = 'kalshi'
        and status = 'resolved'
        and resolved = true
        and is_active = true`,
  ]);

  const pruneCandidates = Number(pruneCandidateRow[0]?.prune_candidates ?? 0);
  const resolvedActiveRows = Number(resolvedActiveRow[0]?.resolved_active_rows ?? 0);

  let deactivatedResolvedRows = 0;
  let deletedPruneCandidates = 0;

  if (execute) {
    const deactivated = await sql<{ count: string }[]>`with updated as (
      update markets
         set is_active = false
       where platform = 'kalshi'
         and status = 'resolved'
         and resolved = true
         and is_active = true
      returning id
    )
    select count(*)::bigint as count from updated`;

    deactivatedResolvedRows = Number(deactivated[0]?.count ?? 0);
    let iterations = 0;

    while (iterations < MAX_ITERATIONS.SCRIPT_OPERATIONS) {
      iterations++;
      const deleted = await sql<{ count: string }[]>`with doomed as (
        select m.id
          from markets m
         where m.platform = 'kalshi'
           and m.status = 'closed'
           and m.resolved = false
           and m.is_active = false
           and m.last_snapshot_at is null
           and m.last_ingested_at < ${cutoffIso}
           and not exists (select 1 from market_resolutions r where r.market_id = m.id)
         limit ${batchSize}
      ), removed as (
        delete from markets
         where id in (select id from doomed)
         returning id
      )
      select count(*)::bigint as count from removed`;

      const deletedCount = Number(deleted[0]?.count ?? 0);
      deletedPruneCandidates += deletedCount;

      if (deletedCount === 0) {
        break;
      }
    }

    if (iterations >= MAX_ITERATIONS.SCRIPT_OPERATIONS) {
      throw new Error(`Pruning exceeded maximum iterations (${MAX_ITERATIONS.SCRIPT_OPERATIONS}). Consider increasing batch size.`);
    }
  }

  console.log(
    JSON.stringify(
      {
        execute,
        min_age_hours: minAgeHours,
        batch_size: batchSize,
        cutoff_iso: cutoffIso,
        prune_candidates: pruneCandidates,
        resolved_active_rows: resolvedActiveRows,
        deleted_prune_candidates: deletedPruneCandidates,
        deactivated_resolved_rows: deactivatedResolvedRows,
      },
      null,
      2,
    ),
  );
} finally {
  await sql.end();
}

function requireEnv(name: string): string {
  const value = env[name];

  if (!value) {
    throw new Error(`${name} must be set in .env to inspect or prune inactive markets.`);
  }

  return value;
}
