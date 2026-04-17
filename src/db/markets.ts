import type { NormalizerResult } from '../api/normalizer.js';
import { chunkArray } from '../lib/collections.js';
import { BATCH_SIZES, MAX_ITERATIONS } from '../lib/constants.js';
import { isMarketActive } from '../lib/market-lifecycle.js';
import type { MusashiMarket } from '../types/market.js';
import type { MarketStatus, ResolutionOutcome } from '../types/market.js';
import { getSupabase } from './supabase.js';

const DB_BATCH_SIZE = BATCH_SIZES.DB_BATCH;

export interface MarketUpsertResult {
  kalshi_new: number;
  polymarket_new: number;
  total_upserted: number;
}

export interface ResolutionCandidate {
  id: string;
  platform: MusashiMarket['platform'];
  platform_id: string;
  closes_at: string | null;
  settles_at: string | null;
}

export interface SnapshotGapCandidate {
  id: string;
  platform: MusashiMarket['platform'];
  platform_id: string;
  last_snapshot_at: string | null;
}

export interface SettlesAtBackfillCandidate {
  id: string;
  platform_id: string;
  closes_at: string | null;
}

interface MarketRow {
  id: string;
  platform: MusashiMarket['platform'];
  platform_id: string;
  event_id: string | null;
  series_id: string | null;
  title: string;
  description: string | null;
  category: MusashiMarket['category'];
  url: string;
  yes_price: number;
  no_price: number;
  volume_24h: number;
  open_interest: number | null;
  liquidity: number | null;
  spread: number | null;
  status: MusashiMarket['status'];
  created_at: string | null;
  closes_at: string | null;
  settles_at: string | null;
  resolved: boolean;
  resolution: MusashiMarket['resolution'];
  resolved_at: string | null;
  source_missing_at: string | null;
  last_ingested_at: string;
  is_active: boolean;
}

export async function upsertMarkets(records: NormalizerResult[]): Promise<MarketUpsertResult> {
  if (records.length === 0) {
    return {
      kalshi_new: 0,
      polymarket_new: 0,
      total_upserted: 0,
    };
  }

  const supabase = getSupabase();
  const ids = records.map(({ market }) => market.id);
  const existingIds = new Set<string>();

  for (const idChunk of chunkArray(ids, DB_BATCH_SIZE)) {
    const { data: existingRows, error: existingError } = await supabase
      .from('markets')
      .select('id, platform')
      .in('id', idChunk);

    if (existingError) {
      throw new Error(`Failed to query existing markets: ${existingError.message || JSON.stringify(existingError)}`);
    }

    for (const row of existingRows ?? []) {
      existingIds.add(row.id as string);
    }
  }

  const rows = records.map(toMarketRow);

  for (const rowChunk of chunkArray(rows, DB_BATCH_SIZE)) {
    const { error } = await supabase.from('markets').upsert(rowChunk, {
      onConflict: 'id',
    });

    if (error) {
      throw new Error(`Failed to upsert markets: ${error.message || JSON.stringify(error)}`);
    }
  }

  let kalshiNew = 0;
  let polymarketNew = 0;

  for (const { market } of records) {
    if (existingIds.has(market.id)) {
      continue;
    }

    if (market.platform === 'kalshi') {
      kalshiNew += 1;
    } else {
      polymarketNew += 1;
    }
  }

  return {
    kalshi_new: kalshiNew,
    polymarket_new: polymarketNew,
    total_upserted: rows.length,
  };
}

export async function listResolutionCandidates(now: Date, limit?: number): Promise<ResolutionCandidate[]> {
  const supabase = getSupabase();
  const nowIso = now.toISOString();
  const terminalCandidates = await fetchResolutionCandidateBatch(supabase, {
    nowIso,
    status: 'terminal',
    ...(limit === undefined ? {} : { limit }),
  });

  if (limit !== undefined && terminalCandidates.length >= limit) {
    return terminalCandidates;
  }

  const remainingLimit = limit === undefined ? undefined : limit - terminalCandidates.length;
  const openCandidates = await fetchResolutionCandidateBatch(supabase, {
    nowIso,
    status: 'open',
    ...(remainingLimit === undefined ? {} : { limit: remainingLimit }),
  });

  return dedupeResolutionCandidates([...terminalCandidates, ...openCandidates], limit);
}

export async function listSnapshotGapCandidates(thresholdIso: string, limit?: number): Promise<SnapshotGapCandidate[]> {
  const supabase = getSupabase();
  let query = supabase
    .from('markets')
    .select('id, platform, platform_id, last_snapshot_at')
    .eq('is_active', true)
    .or(`last_snapshot_at.is.null,last_snapshot_at.lt.${thresholdIso}`);

  if (limit !== undefined) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list snapshot gap candidates: ${error.message}`);
  }

  return (data ?? []) as SnapshotGapCandidate[];
}

export async function listSettlesAtBackfillCandidates(
  now: Date,
  limit?: number
): Promise<SettlesAtBackfillCandidate[]> {
  const supabase = getSupabase();
  let query = supabase
    .from('markets')
    .select('id, platform_id, closes_at')
    .eq('platform', 'kalshi')
    .eq('resolved', false)
    .eq('is_active', false)
    .eq('status', 'closed')
    .is('source_missing_at', null)
    .is('settles_at', null)
    .not('closes_at', 'is', null)
    .lte('closes_at', now.toISOString())
    .order('closes_at', { ascending: true });

  if (limit !== undefined) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list settles_at backfill candidates: ${error.message}`);
  }

  return (data ?? []) as SettlesAtBackfillCandidate[];
}

export async function updateMarketLifecycle(
  marketId: string,
  updates: {
    status: MarketStatus;
    resolved: boolean;
    resolution: ResolutionOutcome | null;
    resolved_at: string | null;
    settles_at?: string | null;
    last_ingested_at: string;
  }
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('markets')
    .update({
      status: updates.status,
      resolved: updates.resolved,
      resolution: updates.resolution,
      resolved_at: updates.resolved_at,
      settles_at: updates.settles_at,
      last_ingested_at: updates.last_ingested_at,
      is_active: isMarketActive(updates.status, updates.resolved),
    })
    .eq('id', marketId);

  if (error) {
    throw new Error(`Failed to update market lifecycle: ${error.message}`);
  }
}

export async function updateMarketSettlesAt(
  marketId: string,
  settlesAt: string,
  lastIngestedAt: string
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('markets')
    .update({
      settles_at: settlesAt,
      last_ingested_at: lastIngestedAt,
    })
    .eq('id', marketId);

  if (error) {
    throw new Error(`Failed to update market settles_at: ${error.message}`);
  }
}

export async function markMarketSourceMissing(
  marketId: string,
  missingAt: string,
  fallbackSettlesAt?: string | null
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('markets')
    .update({
      status: 'closed',
      resolved: false,
      resolution: null,
      source_missing_at: missingAt,
      settles_at: fallbackSettlesAt ?? null,
      last_ingested_at: missingAt,
      is_active: false,
    })
    .eq('id', marketId);

  if (error) {
    throw new Error(`Failed to mark market source_missing_at: ${error.message}`);
  }
}

export async function reconcileMissingOpenMarkets(
  platform: MusashiMarket['platform'],
  crawlStartedAtIso: string
): Promise<number> {
  const supabase = getSupabase();
  let totalUpdated = 0;
  let iterations = 0;

  while (iterations < MAX_ITERATIONS.DB_RECONCILIATION) {
    iterations++;

    const { data: staleRows, error: selectError } = await supabase
      .from('markets')
      .select('id')
      .eq('platform', platform)
      .eq('status', 'open')
      .eq('resolved', false)
      .lt('last_ingested_at', crawlStartedAtIso)
      .limit(DB_BATCH_SIZE);

    if (selectError) {
      throw new Error(`Failed to select missing open markets: ${selectError.message}`);
    }

    const ids = (staleRows ?? []).map((row) => String(row.id));

    if (ids.length === 0) {
      break;
    }

    const { error: updateError } = await supabase
      .from('markets')
      .update({
        status: 'closed',
        is_active: false,
      })
      .in('id', ids);

    if (updateError) {
      throw new Error(`Failed to reconcile missing open markets: ${updateError.message}`);
    }

    totalUpdated += ids.length;
  }

  if (iterations >= MAX_ITERATIONS.DB_RECONCILIATION) {
    throw new Error(
      `Reconciliation exceeded maximum iterations (${MAX_ITERATIONS.DB_RECONCILIATION}). Updated ${totalUpdated} markets before stopping.`
    );
  }

  return totalUpdated;
}

function toMarketRow({ market }: NormalizerResult): MarketRow {
  return {
    id: market.id,
    platform: market.platform,
    platform_id: market.platform_id,
    event_id: market.event_id,
    series_id: market.series_id,
    title: market.title,
    description: market.description,
    category: market.category,
    url: market.url,
    yes_price: market.yes_price,
    no_price: market.no_price,
    volume_24h: market.volume_24h,
    open_interest: market.open_interest,
    liquidity: market.liquidity,
    spread: market.spread,
    status: market.status,
    created_at: market.created_at,
    closes_at: market.closes_at,
    settles_at: market.settles_at,
    resolved: market.resolved,
    resolution: market.resolution,
    resolved_at: market.resolved_at,
    source_missing_at: null,
    last_ingested_at: market.fetched_at,
    is_active: true,
  };
}

async function fetchResolutionCandidateBatch(
  supabase: ReturnType<typeof getSupabase>,
  options: {
    nowIso: string;
    status: 'terminal' | 'open';
    limit?: number;
  }
): Promise<ResolutionCandidate[]> {
  const statusScopedQuery = () => {
    const baseQuery = supabase
      .from('markets')
      .select('id, platform, platform_id, closes_at, settles_at')
      .eq('resolved', false)
      .is('source_missing_at', null);

    if (options.status === 'terminal') {
      return baseQuery.in('status', ['closed', 'resolved']);
    }

    return baseQuery.eq('status', 'open');
  };

  const dueBySettlementQuery = statusScopedQuery()
    .not('settles_at', 'is', null)
    .lte('settles_at', options.nowIso)
    .order('settles_at', { ascending: true });

  if (options.limit !== undefined) {
    dueBySettlementQuery.limit(options.limit);
  }

  const { data: dueBySettlement, error: dueBySettlementError } = await dueBySettlementQuery;

  if (dueBySettlementError) {
    throw new Error(`Failed to list ${options.status} resolution candidates: ${dueBySettlementError.message}`);
  }

  const settlementCandidates = (dueBySettlement ?? []) as ResolutionCandidate[];
  if (options.limit !== undefined && settlementCandidates.length >= options.limit) {
    return settlementCandidates.slice(0, options.limit);
  }

  const remainingLimit =
    options.limit === undefined ? undefined : Math.max(options.limit - settlementCandidates.length, 0);
  const dueByCloseQuery = statusScopedQuery()
    .is('settles_at', null)
    .not('closes_at', 'is', null)
    .lte('closes_at', options.nowIso)
    .order('closes_at', { ascending: true });

  if (remainingLimit !== undefined) {
    dueByCloseQuery.limit(remainingLimit);
  }

  const { data: dueByClose, error: dueByCloseError } = await dueByCloseQuery;

  if (dueByCloseError) {
    throw new Error(`Failed to list ${options.status} resolution candidates: ${dueByCloseError.message}`);
  }

  return [...settlementCandidates, ...((dueByClose ?? []) as ResolutionCandidate[])].sort((left, right) =>
    getResolutionDueTime(left).localeCompare(getResolutionDueTime(right))
  );
}

function dedupeResolutionCandidates(candidates: ResolutionCandidate[], limit?: number): ResolutionCandidate[] {
  const seen = new Set<string>();
  const deduped: ResolutionCandidate[] = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.id)) {
      continue;
    }

    seen.add(candidate.id);
    deduped.push(candidate);

    if (limit !== undefined && deduped.length >= limit) {
      break;
    }
  }

  return deduped;
}

function getResolutionDueTime(candidate: ResolutionCandidate): string {
  return candidate.settles_at ?? candidate.closes_at ?? '9999-12-31T23:59:59.999Z';
}
