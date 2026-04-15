import postgres from 'postgres';

import { loadRuntimeEnv } from '../src/lib/runtime-env.js';

const env = await loadRuntimeEnv(new URL('../.env', import.meta.url));

const host = requireEnv('SUPABASE_DB_HOST');
const database = requireEnv('SUPABASE_DB_NAME');
const username = requireEnv('SUPABASE_DB_USER');
const password = requireEnv('SUPABASE_DB_PASSWORD');

const minAgeHours = Number(env.MARKET_COMPACT_MIN_AGE_HOURS ?? '24');
const batchSize = Number(env.MARKET_COMPACT_BATCH_SIZE ?? '1000');
const execute = env.MARKET_COMPACT_EXECUTE === 'true';
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
  const candidateRows = await sql.unsafe<{ compact_candidates: string }[]>(`select count(*)::bigint as compact_candidates
    from markets m
   where m.platform = 'kalshi'
     and m.is_active = false
     and m.status in ('closed', 'resolved')
     and (
       (m.status = 'closed' and m.closes_at < '${cutoffIso}')
       or (m.status = 'resolved' and coalesce(m.resolved_at, m.closes_at) < '${cutoffIso}')
     )
     and m.is_compacted = false`);

  const compactCandidates = Number(candidateRows[0]?.compact_candidates ?? 0);
  let archivedCount = 0;
  let compactedCount = 0;

  if (execute) {
    while (true) {
      const moved = await sql.unsafe<{ archived_count: string; compacted_count: string }[]>(`with candidate_batch as (
        select id
          from markets m
         where m.platform = 'kalshi'
           and m.is_active = false
           and m.status in ('closed', 'resolved')
           and (
             (m.status = 'closed' and m.closes_at < '${cutoffIso}')
             or (m.status = 'resolved' and coalesce(m.resolved_at, m.closes_at) < '${cutoffIso}')
           )
           and m.is_compacted = false
         order by coalesce(m.resolved_at, m.closes_at, m.last_ingested_at) asc
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
          resolved,
          resolution,
          resolved_at,
          first_seen_at,
          last_ingested_at,
          last_snapshot_at,
          is_active,
          archived_at,
          archive_reason
        )
        select
          m.id,
          m.platform,
          m.platform_id,
          m.event_id,
          m.series_id,
          m.title,
          m.description,
          m.category,
          m.url,
          m.yes_price,
          m.no_price,
          m.volume_24h,
          m.open_interest,
          m.liquidity,
          m.spread,
          m.status,
          m.created_at,
          m.closes_at,
          m.resolved,
          m.resolution,
          m.resolved_at,
          m.first_seen_at,
          m.last_ingested_at,
          m.last_snapshot_at,
          m.is_active,
          now(),
          case
            when m.resolved = true then 'compacted_resolved_market'
            else 'compacted_inactive_market'
          end
        from markets m
        join candidate_batch cb on cb.id = m.id
        on conflict (id) do nothing
        returning id
      ), compacted as (
        update markets
           set event_id = null,
               series_id = null,
               description = null,
               url = '/archived/' || platform_id,
               volume_24h = 0,
               open_interest = null,
               liquidity = null,
               spread = null,
               is_compacted = true,
               compacted_at = now()
         where id in (select id from candidate_batch)
           and exists (select 1 from markets_archive ma where ma.id = markets.id)
         returning id
      )
      select
        (select count(*)::bigint from archived) as archived_count,
        (select count(*)::bigint from compacted) as compacted_count`);

      const archivedBatch = Number(moved[0]?.archived_count ?? 0);
      const compactedBatch = Number(moved[0]?.compacted_count ?? 0);

      archivedCount += archivedBatch;
      compactedCount += compactedBatch;

      if (compactedBatch === 0) {
        break;
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        execute,
        min_age_hours: minAgeHours,
        batch_size: batchSize,
        cutoff_iso: cutoffIso,
        compact_candidates: compactCandidates,
        archived_count: archivedCount,
        compacted_count: compactedCount,
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
    throw new Error(`${name} must be set in .env to inspect or compact inactive markets.`);
  }

  return value;
}
