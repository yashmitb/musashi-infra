import type { IngestionRunRecord } from '../types/storage.js';
import { getSupabase } from './supabase.js';

export async function startRun(input: Pick<IngestionRunRecord, 'job_id' | 'run_type' | 'started_at' | 'status'>): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('ingestion_runs').insert(input);

  if (error) {
    throw new Error(`Failed to insert ingestion run start record: ${error.message}`);
  }
}

export async function failOpenRuns(runType: string, errorMessage: string): Promise<void> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('ingestion_runs')
    .update({
      completed_at: now,
      status: 'failed',
      notes: errorMessage,
    })
    .eq('run_type', runType)
    .is('completed_at', null);

  if (error) {
    throw new Error(`Failed to fail open ingestion runs: ${error.message}`);
  }
}

export async function completeRun(run: IngestionRunRecord): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('ingestion_runs')
    .update({
      completed_at: run.completed_at,
      duration_ms: run.duration_ms,
      kalshi_markets_fetched: run.kalshi_markets_fetched,
      kalshi_markets_new: run.kalshi_markets_new,
      kalshi_snapshots_written: run.kalshi_snapshots_written,
      kalshi_errors: run.kalshi_errors,
      kalshi_available: run.kalshi_available,
      kalshi_fetch_ms: run.kalshi_fetch_ms,
      polymarket_markets_fetched: run.polymarket_markets_fetched,
      polymarket_markets_new: run.polymarket_markets_new,
      polymarket_snapshots_written: run.polymarket_snapshots_written,
      polymarket_errors: run.polymarket_errors,
      polymarket_available: run.polymarket_available,
      polymarket_fetch_ms: run.polymarket_fetch_ms,
      resolutions_detected: run.resolutions_detected,
      errors: run.errors,
      status: run.status,
      notes: run.notes,
    })
    .eq('job_id', run.job_id);

  if (error) {
    throw new Error(`Failed to complete ingestion run: ${error.message}`);
  }
}

export async function updateRunProgress(
  jobId: string,
  updates: Partial<
    Pick<
      IngestionRunRecord,
      | 'kalshi_markets_fetched'
      | 'kalshi_markets_new'
      | 'kalshi_snapshots_written'
      | 'kalshi_errors'
      | 'kalshi_available'
      | 'kalshi_fetch_ms'
      | 'resolutions_detected'
      | 'errors'
      | 'status'
      | 'notes'
    >
  >,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('ingestion_runs').update(updates).eq('job_id', jobId);

  if (error) {
    throw new Error(`Failed to update ingestion run progress: ${error.message}`);
  }
}
