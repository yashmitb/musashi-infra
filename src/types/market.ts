export const MARKET_PLATFORMS = ['kalshi', 'polymarket'] as const;

export type MarketPlatform = (typeof MARKET_PLATFORMS)[number];

export const MARKET_CATEGORIES = [
  'fed_policy',
  'economics',
  'financial_markets',
  'us_politics',
  'geopolitics',
  'technology',
  'crypto',
  'sports',
  'climate',
  'entertainment',
  'other',
] as const;

export type MarketCategory = (typeof MARKET_CATEGORIES)[number];

export const MARKET_STATUSES = ['open', 'closed', 'resolved'] as const;

export type MarketStatus = (typeof MARKET_STATUSES)[number];

export const RESOLUTION_OUTCOMES = ['YES', 'NO'] as const;

export type ResolutionOutcome = (typeof RESOLUTION_OUTCOMES)[number];

export interface MusashiMarket {
  id: string;
  platform: MarketPlatform;
  platform_id: string;
  event_id: string | null;
  series_id: string | null;
  title: string;
  description: string | null;
  category: MarketCategory;
  url: string;
  yes_price: number;
  no_price: number;
  volume_24h: number;
  open_interest: number | null;
  liquidity: number | null;
  spread: number | null;
  status: MarketStatus;
  created_at: string | null;
  closes_at: string | null;
  resolved: boolean;
  resolution: ResolutionOutcome | null;
  resolved_at: string | null;
  fetched_at: string;
  cache_hit: boolean;
  data_age_seconds: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

function isMarketCategory(value: unknown): value is MarketCategory {
  return typeof value === 'string' && MARKET_CATEGORIES.includes(value as MarketCategory);
}

function isMarketPlatform(value: unknown): value is MarketPlatform {
  return typeof value === 'string' && MARKET_PLATFORMS.includes(value as MarketPlatform);
}

function isMarketStatus(value: unknown): value is MarketStatus {
  return typeof value === 'string' && MARKET_STATUSES.includes(value as MarketStatus);
}

function isResolutionOutcome(value: unknown): value is ResolutionOutcome | null {
  return value === null || (typeof value === 'string' && RESOLUTION_OUTCOMES.includes(value as ResolutionOutcome));
}

export function isMusashiMarket(value: unknown): value is MusashiMarket {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    value.id.startsWith('musashi-') &&
    isMarketPlatform(value.platform) &&
    typeof value.platform_id === 'string' &&
    value.platform_id.length > 0 &&
    isNullableString(value.event_id) &&
    isNullableString(value.series_id) &&
    typeof value.title === 'string' &&
    value.title.length > 0 &&
    isNullableString(value.description) &&
    isMarketCategory(value.category) &&
    typeof value.url === 'string' &&
    typeof value.yes_price === 'number' &&
    value.yes_price >= 0 &&
    value.yes_price <= 1 &&
    typeof value.no_price === 'number' &&
    value.no_price >= 0 &&
    value.no_price <= 1 &&
    Math.abs(value.yes_price + value.no_price - 1) < 0.001 &&
    typeof value.volume_24h === 'number' &&
    isNullableNumber(value.open_interest) &&
    isNullableNumber(value.liquidity) &&
    isNullableNumber(value.spread) &&
    isMarketStatus(value.status) &&
    isNullableString(value.created_at) &&
    isNullableString(value.closes_at) &&
    typeof value.resolved === 'boolean' &&
    isResolutionOutcome(value.resolution) &&
    isNullableString(value.resolved_at) &&
    typeof value.fetched_at === 'string' &&
    typeof value.cache_hit === 'boolean' &&
    typeof value.data_age_seconds === 'number' &&
    value.data_age_seconds >= 0
  );
}
