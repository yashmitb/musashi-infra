import type { MusashiMarket } from '../types/market.js';
import { chunkArray } from '../lib/collections.js';
import { truncateToHour } from '../lib/time.js';
import { getSupabase } from './supabase.js';

const DB_BATCH_SIZE = 200;

export interface SnapshotWriteOptions {
  source: string;
  fetchLatencyMs?: number | null;
}

export interface SnapshotWriteResult {
  kalshi_written: number;
  polymarket_written: number;
  total_written: number;
}

interface SnapshotRow {
  market_id: string;
  snapshot_time: string;
  yes_price: number;
  no_price: number;
  volume_24h: number | null;
  open_interest: number | null;
  liquidity: number | null;
  spread: number | null;
  source: string;
  fetch_latency_ms: number | null;
}

export async function writeSnapshots(
  markets: MusashiMarket[],
  snapshotTime: Date,
  options: SnapshotWriteOptions
): Promise<SnapshotWriteResult> {
  if (markets.length === 0) {
    return {
      kalshi_written: 0,
      polymarket_written: 0,
      total_written: 0,
    };
  }

  const supabase = getSupabase();
  const truncatedSnapshotTime = truncateToHour(snapshotTime).toISOString();
  const rows: SnapshotRow[] = markets.map((market) => ({
    market_id: market.id,
    snapshot_time: truncatedSnapshotTime,
    yes_price: market.yes_price,
    no_price: market.no_price,
    volume_24h: market.volume_24h,
    open_interest: market.open_interest,
    liquidity: market.liquidity,
    spread: market.spread,
    source: options.source,
    fetch_latency_ms: options.fetchLatencyMs ?? null,
  }));

  const existingIds = new Set<string>();
  const marketIds = markets.map((market) => market.id);

  for (const idChunk of chunkArray(marketIds, DB_BATCH_SIZE)) {
    const { data: existingRows, error: existingError } = await supabase
      .from('market_snapshots')
      .select('market_id')
      .eq('snapshot_time', truncatedSnapshotTime)
      .in('market_id', idChunk);

    if (existingError) {
      throw new Error(`Failed to query existing snapshots: ${existingError.message || JSON.stringify(existingError)}`);
    }

    for (const row of existingRows ?? []) {
      existingIds.add(row.market_id as string);
    }
  }

  for (const rowChunk of chunkArray(rows, DB_BATCH_SIZE)) {
    const { error: snapshotError } = await supabase.from('market_snapshots').upsert(rowChunk, {
      onConflict: 'market_id,snapshot_time',
      ignoreDuplicates: true,
    });

    if (snapshotError) {
      throw new Error(`Failed to write market snapshots: ${snapshotError.message || JSON.stringify(snapshotError)}`);
    }
  }

  for (const idChunk of chunkArray(marketIds, DB_BATCH_SIZE)) {
    const { error: marketsError } = await supabase
      .from('markets')
      .update({ last_snapshot_at: truncatedSnapshotTime })
      .in('id', idChunk);

    if (marketsError) {
      throw new Error(
        `Failed to update market last_snapshot_at: ${marketsError.message || JSON.stringify(marketsError)}`
      );
    }
  }

  let kalshiWritten = 0;
  let polymarketWritten = 0;

  for (const market of markets) {
    if (existingIds.has(market.id)) {
      continue;
    }

    if (market.platform === 'kalshi') {
      kalshiWritten += 1;
    } else {
      polymarketWritten += 1;
    }
  }

  return {
    kalshi_written: kalshiWritten,
    polymarket_written: polymarketWritten,
    total_written: kalshiWritten + polymarketWritten,
  };
}
