export interface CollectionCheckpointSummary {
  updated_at: string;
  market_count: number;
  page_count: number;
}

export interface CollectionRunSummary {
  started_at: string;
  completed_at: string | null;
  status: string;
  error_types: string[];
}

export interface CollectionSourceHealthSummary {
  is_available: boolean;
  last_successful_fetch: string | null;
  last_error: string | null;
}

export interface CollectionHealthInput {
  now: Date;
  checkpoint: CollectionCheckpointSummary | null;
  latestRun: CollectionRunSummary | null;
  sourceHealth: CollectionSourceHealthSummary | null;
  stallMaxMinutes: number;
  runMaxAgeMinutes: number;
}

export interface CollectionHealthResult {
  healthy: boolean;
  reasons: string[];
}

export function evaluateCollectionHealth(input: CollectionHealthInput): CollectionHealthResult {
  const reasons: string[] = [];
  const latestRunCompletedSuccessfully =
    input.latestRun !== null &&
    input.latestRun.completed_at !== null &&
    input.latestRun.status === 'success' &&
    input.latestRun.error_types.length === 0;
  const latestRunBudgetBounded =
    input.latestRun !== null &&
    input.latestRun.completed_at !== null &&
    (input.latestRun.status === 'success' || input.latestRun.status === 'partial') &&
    input.latestRun.error_types.every((errorType) => ['page_budget_exhausted'].includes(errorType));
  const sourceFetchFresh =
    input.sourceHealth?.last_successful_fetch !== null &&
    input.sourceHealth?.last_successful_fetch !== undefined &&
    minutesSince(input.sourceHealth.last_successful_fetch, input.now) <= input.stallMaxMinutes;

  if (input.checkpoint === null) {
    if (!latestRunCompletedSuccessfully) {
      reasons.push('Missing kalshi_full_sync checkpoint');
    }
  } else if (
    minutesSince(input.checkpoint.updated_at, input.now) > input.stallMaxMinutes &&
    !(latestRunBudgetBounded && sourceFetchFresh)
  ) {
    reasons.push(`Checkpoint stale for more than ${input.stallMaxMinutes} minutes`);
  }

  if (input.sourceHealth === null) {
    reasons.push('Missing source_health row for kalshi');
  } else {
    if (!input.sourceHealth.is_available) {
      reasons.push('Kalshi source marked unavailable');
    }
    if (input.sourceHealth.last_error) {
      reasons.push(`Kalshi source error present: ${input.sourceHealth.last_error}`);
    }
  }

  if (input.latestRun === null) {
    reasons.push('No full_sync ingestion runs found');
  } else {
    if (
      input.latestRun.completed_at === null &&
      minutesSince(input.latestRun.started_at, input.now) > input.runMaxAgeMinutes
    ) {
      reasons.push(`Latest full_sync run has been running for more than ${input.runMaxAgeMinutes} minutes`);
    }

    if (input.latestRun.status === 'failed') {
      reasons.push('Latest full_sync run failed');
    }

    if (input.latestRun.error_types.some((errorType) => !['page_budget_exhausted'].includes(errorType))) {
      reasons.push(`Latest full_sync run has non-budget errors: ${input.latestRun.error_types.join(', ')}`);
    }
  }

  return {
    healthy: reasons.length === 0,
    reasons,
  };
}

function minutesSince(isoTimestamp: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(isoTimestamp).getTime()) / 60000));
}
