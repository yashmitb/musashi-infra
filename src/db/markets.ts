import type { NormalizerResult } from '../api/normalizer.js';
import { chunkArray } from '../lib/collections.js';
import type { MusashiMarket } from '../types/market.js';
import { getSupabase } from './supabase.js';

const DB_BATCH_SIZE = 200;

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
}

export interface SnapshotGapCandidate {
  id: string;
  platform: MusashiMarket['platform'];
  platform_id: string;
  last_snapshot_at: string | null;
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
  resolved: boolean;
  resolution: MusashiMarket['resolution'];
  resolved_at: string | null;
  last_ingested_at: string;
  is_active: boolean;
  platform_raw: unknown;
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
  let query = supabase
    .from('markets')
    .select('id, platform, platform_id, closes_at')
    .eq('resolved', false)
    .lte('closes_at', now.toISOString())
    .order('closes_at', { ascending: true });

  if (limit !== undefined) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list resolution candidates: ${error.message}`);
  }

  return (data ?? []) as ResolutionCandidate[];
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

function toMarketRow({ market, platform_raw }: NormalizerResult): MarketRow {
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
    resolved: market.resolved,
    resolution: market.resolution,
    resolved_at: market.resolved_at,
    last_ingested_at: market.fetched_at,
    is_active: true,
    platform_raw,
  };
}
