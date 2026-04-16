import type { MusashiMarket } from '../types/market.js';

export interface SnapshotCandidatePolicy {
  limit: number;
  activeWindowHours: number;
  minVolume24h: number;
  minLiquidity: number;
}

export function selectSnapshotCandidates(
  markets: MusashiMarket[],
  now: Date,
  policy: SnapshotCandidatePolicy
): MusashiMarket[] {
  if (policy.limit <= 0) {
    return [];
  }

  const cutoffMs = now.getTime() + policy.activeWindowHours * 60 * 60 * 1000;

  return markets
    .filter((market) => !market.resolved)
    .filter((market) => {
      const closesAtMs = market.closes_at ? new Date(market.closes_at).getTime() : null;
      const closesSoon = closesAtMs !== null && closesAtMs <= cutoffMs;
      const isMeaningfullyActive =
        market.volume_24h >= policy.minVolume24h || (market.liquidity ?? 0) >= policy.minLiquidity;

      return closesSoon || isMeaningfullyActive;
    })
    .sort((left, right) => compareSnapshotPriority(left, right, cutoffMs))
    .slice(0, policy.limit);
}

function compareSnapshotPriority(left: MusashiMarket, right: MusashiMarket, cutoffMs: number): number {
  const leftClosesSoon = isWithinWindow(left.closes_at, cutoffMs);
  const rightClosesSoon = isWithinWindow(right.closes_at, cutoffMs);

  if (leftClosesSoon !== rightClosesSoon) {
    return leftClosesSoon ? -1 : 1;
  }

  const leftCloseTime = left.closes_at ? new Date(left.closes_at).getTime() : Number.POSITIVE_INFINITY;
  const rightCloseTime = right.closes_at ? new Date(right.closes_at).getTime() : Number.POSITIVE_INFINITY;

  if (leftCloseTime !== rightCloseTime) {
    return leftCloseTime - rightCloseTime;
  }

  const rightActivity = right.volume_24h + (right.liquidity ?? 0);
  const leftActivity = left.volume_24h + (left.liquidity ?? 0);

  if (leftActivity !== rightActivity) {
    return rightActivity - leftActivity;
  }

  return left.id.localeCompare(right.id);
}

function isWithinWindow(closesAt: string | null, cutoffMs: number): boolean {
  if (!closesAt) {
    return false;
  }

  return new Date(closesAt).getTime() <= cutoffMs;
}
