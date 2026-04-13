import type { MarketResolution } from '../types/storage.js';
import { chunkArray } from '../lib/collections.js';
import { isMarketActive } from '../lib/market-lifecycle.js';
import { getSupabase } from './supabase.js';

const DB_BATCH_SIZE = 200;

export async function insertResolution(resolution: MarketResolution): Promise<boolean> {
  return insertResolutions([resolution]).then((count) => count > 0);
}

export async function insertResolutions(resolutions: MarketResolution[]): Promise<number> {
  if (resolutions.length === 0) {
    return 0;
  }

  const supabase = getSupabase();
  const marketIds = resolutions.map((resolution) => resolution.market_id);
  const existingIds = new Set<string>();

  for (const idChunk of chunkArray(marketIds, DB_BATCH_SIZE)) {
    const { data: existingRows, error: existingError } = await supabase
      .from('market_resolutions')
      .select('market_id')
      .in('market_id', idChunk);

    if (existingError) {
      throw new Error(`Failed to query existing resolutions: ${existingError.message}`);
    }

    for (const row of existingRows ?? []) {
      existingIds.add(row.market_id as string);
    }
  }

  const pending = resolutions.filter((resolution) => !existingIds.has(resolution.market_id));

  for (const resolutionChunk of chunkArray(pending, DB_BATCH_SIZE)) {
    const { error: resolutionError } = await supabase.from('market_resolutions').insert(resolutionChunk);

    if (resolutionError) {
      throw new Error(`Failed to insert market resolutions: ${resolutionError.message}`);
    }
  }

  return pending.length;
}

export async function applyResolvedMarketState(resolutions: MarketResolution[]): Promise<void> {
  if (resolutions.length === 0) {
    return;
  }

  const supabase = getSupabase();

  for (const resolutionChunk of chunkArray(resolutions, DB_BATCH_SIZE)) {
    for (const resolution of resolutionChunk) {
      const { error: marketError } = await supabase
        .from('markets')
        .update({
          resolved: true,
          status: 'resolved',
          is_active: isMarketActive('resolved', true),
          resolution: resolution.outcome,
          resolved_at: resolution.resolved_at,
          last_ingested_at: resolution.detected_at,
        })
        .eq('id', resolution.market_id);

      if (marketError) {
        throw new Error(`Failed to update resolved market state: ${marketError.message}`);
      }
    }
  }

}
