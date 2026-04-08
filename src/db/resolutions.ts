import type { MarketResolution } from '../types/storage.js';
import { getSupabase } from './supabase.js';

export async function insertResolution(resolution: MarketResolution): Promise<boolean> {
  const supabase = getSupabase();

  const { data: existing, error: existingError } = await supabase
    .from('market_resolutions')
    .select('market_id')
    .eq('market_id', resolution.market_id)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to query existing resolution: ${existingError.message}`);
  }

  if (existing) {
    return false;
  }

  const { error: resolutionError } = await supabase.from('market_resolutions').insert(resolution);

  if (resolutionError) {
    throw new Error(`Failed to insert market resolution: ${resolutionError.message}`);
  }

  const { error: marketError } = await supabase
    .from('markets')
    .update({
      resolved: true,
      status: 'resolved',
      resolution: resolution.outcome,
      resolved_at: resolution.resolved_at,
    })
    .eq('id', resolution.market_id);

  if (marketError) {
    throw new Error(`Failed to update resolved market state: ${marketError.message}`);
  }

  return true;
}
