import { getSupabase } from './supabase.js';

export interface SourceHealthUpdateInput {
  source: string;
  is_available: boolean;
  market_count: number;
  last_successful_fetch?: string | null;
  last_error?: string | null;
  last_error_at?: string | null;
}

export async function updateSourceHealth(input: SourceHealthUpdateInput): Promise<void> {
  const supabase = getSupabase();
  const payload = {
    source: input.source,
    is_available: input.is_available,
    market_count: input.market_count,
    last_successful_fetch: input.last_successful_fetch ?? (input.is_available ? new Date().toISOString() : null),
    last_error: input.last_error ?? null,
    last_error_at: input.last_error_at ?? (input.last_error ? new Date().toISOString() : null),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('source_health').upsert(payload, {
    onConflict: 'source',
  });

  if (error) {
    throw new Error(`Failed to update source health: ${error.message}`);
  }
}
