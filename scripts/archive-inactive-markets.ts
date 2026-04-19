import postgres from 'postgres';

import { MAX_ITERATIONS } from '../src/lib/constants.js';
import { loadRuntimeEnv } from '../src/lib/runtime-env.js';

const env = await loadRuntimeEnv(new URL('../.env', import.meta.url));

const host = requireEnv('SUPABASE_DB_HOST');
const database = requireEnv('SUPABASE_DB_NAME');
const username = requireEnv('SUPABASE_DB_USER');
const password = requireEnv('SUPABASE_DB_PASSWORD');

const minAgeHours = Number(env.MARKET_ARCHIVE_MIN_AGE_HOURS ?? '24');
const batchSize = Number(env.MARKET_ARCHIVE_BATCH_SIZE ?? '1000');
const execute = env.MARKET_ARCHIVE_EXECUTE === 'true';
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
  const candidateRows = await sql<{ archive_candidates: string }[]>`select count(*)::bigint as archive_candidates
    from markets m
   where m.platform = 'kalshi'
     and m.status = 'closed'
     and m.resolved = false
     and m.is_active = false
     and m.last_snapshot_at is null
     and m.last_ingested_at < ${cutoffIso}
     and not exists (select 1 from market_resolutions r where r.market_id = m.id)`;

  const archiveCandidates = Number(candidateRows[0]?.archive_candidates ?? 0);
  let archivedCount = 0;
  let deletedCount = 0;

  if (execute) {
    let iterations = 0;

    while (iterations < MAX_ITERATIONS.SCRIPT_OPERATIONS) {
      iterations++;
      const moved = await sql<{ archived_count: string; deleted_count: string }[]>`with candidate_batch as (
        select *
          from markets m
         where m.platform = 'kalshi'
           and m.status = 'closed'
           and m.resolved = false
           and m.is_active = false
           and m.last_snapshot_at is null
           and m.last_ingested_at < ${cutoffIso}
           and not exists (select 1 from market_resolutions r where r.market_id = m.id)
         order by m.last_ingested_at asc
         limit ${batchSize}
      ), archived as (
        insert into markets_archive (
          id,
          platform,
          platform_id,
          event_id,
          series_id,
          title,
          description,
          category,
          url,
          yes_price,
          no_price,
          volume_24h,
          open_interest,
          liquidity,
          spread,
          status,
          created_at,
          closes_at,
          settles_at,
          resolved,
          resolution,
          resolved_at,
          source_missing_at,
          first_seen_at,
          last_ingested_at,
          last_snapshot_at,
          is_active,
          archived_at,
          archive_reason
        )
        select
          id,
          platform,
          platform_id,
          event_id,
          series_id,
          title,
          description,
          category,
          url,
          yes_price,
          no_price,
          volume_24h,
          open_interest,
          liquidity,
          spread,
          status,
          created_at,
          closes_at,
          settles_at,
          resolved,
          resolution,
          resolved_at,
          source_missing_at,
          first_seen_at,
          last_ingested_at,
          last_snapshot_at,
          is_active,
          now(),
          'inactive_no_snapshot_no_resolution'
        from candidate_batch
        on conflict (id) do nothing
        returning id
      ), deleted as (
        delete from markets
         where id in (select id from archived)
         returning id
      )
      select
        (select count(*)::bigint from archived) as archived_count,
        (select count(*)::bigint from deleted) as deleted_count`;

      const archivedBatch = Number(moved[0]?.archived_count ?? 0);
      const deletedBatch = Number(moved[0]?.deleted_count ?? 0);

      archivedCount += archivedBatch;
      deletedCount += deletedBatch;

      if (archivedBatch === 0) {
        break;
      }
    }

    if (iterations >= MAX_ITERATIONS.SCRIPT_OPERATIONS) {
      throw new Error(
        `Archiving exceeded maximum iterations (${MAX_ITERATIONS.SCRIPT_OPERATIONS}). Consider increasing batch size.`
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        execute,
        min_age_hours: minAgeHours,
        batch_size: batchSize,
        cutoff_iso: cutoffIso,
        archive_candidates: archiveCandidates,
        archived_count: archivedCount,
        deleted_count: deletedCount,
      },
      null,
      2
    )
  );
} finally {
  await sql.end();
}

function requireEnv(name: string): string {
  const value = env[name];

  if (!value) {
    throw new Error(`${name} must be set in .env to inspect or archive inactive markets.`);
  }

  return value;
}
