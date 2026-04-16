import type { SyncCheckpoint } from '../types/storage.js';
import { getSupabase } from './supabase.js';

export async function getCheckpoint(checkpointKey: string): Promise<SyncCheckpoint | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('sync_checkpoints')
    .select('*')
    .eq('checkpoint_key', checkpointKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get sync checkpoint: ${error.message}`);
  }

  return (data as SyncCheckpoint | null) ?? null;
}

export async function upsertCheckpoint(checkpoint: Omit<SyncCheckpoint, 'updated_at'>): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('sync_checkpoints').upsert(
    {
      ...checkpoint,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'checkpoint_key',
    }
  );

  if (error) {
    throw new Error(`Failed to upsert sync checkpoint: ${error.message}`);
  }
}

export async function clearCheckpoint(checkpointKey: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('sync_checkpoints').delete().eq('checkpoint_key', checkpointKey);

  if (error) {
    throw new Error(`Failed to clear sync checkpoint: ${error.message}`);
  }
}
