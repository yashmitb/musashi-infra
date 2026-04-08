import { parseKalshiDollars, parseKalshiSize } from '../lib/prices.js';
import { secondsSince } from '../lib/time.js';
import type { KalshiMarketRaw } from '../types/kalshi-raw.js';
import type {
  MarketCategory,
  MarketStatus,
  MusashiMarket,
  ResolutionOutcome,
} from '../types/market.js';

export interface NormalizerResult {
  market: MusashiMarket;
  platform_raw: unknown;
  warnings: string[];
}

export interface NormalizerError {
  platform_id: string;
  error: string;
  raw_data: unknown;
}

export interface NormalizationBatch {
  normalized: NormalizerResult[];
  errors: NormalizerError[];
}

export function normalizeKalshiMarket(raw: KalshiMarketRaw, fetchedAt: Date): NormalizerResult {
  const warnings: string[] = [];
  const yesPrice = deriveKalshiYesPrice(raw, warnings);
  const noPrice = roundPrice(1 - yesPrice);
  const title = raw.title?.trim();

  if (!title) {
    throw new Error(`Kalshi market ${raw.ticker} is missing a title`);
  }

  const status = mapKalshiStatus(raw.status);
  const resolution = mapKalshiResult(raw.result);
  const resolved = status === 'resolved' && resolution !== null;

  return {
    market: {
      id: `musashi-kalshi-${raw.ticker}`,
      platform: 'kalshi',
      platform_id: raw.ticker,
      event_id: raw.event_ticker,
      series_id: raw.series_ticker ?? null,
      title,
      description: raw.subtitle?.trim() ?? null,
      category: normalizeKalshiCategory(raw),
      url: `https://kalshi.com/markets/${raw.event_ticker}/${raw.ticker}`,
      yes_price: yesPrice,
      no_price: noPrice,
      volume_24h: parseKalshiSize(raw.volume_24h_fp) ?? 0,
      open_interest: parseKalshiSize(raw.open_interest_fp),
      liquidity: parseKalshiDollars(raw.liquidity_dollars),
      spread: deriveKalshiSpread(raw),
      status,
      created_at: raw.created_time ?? raw.open_time ?? null,
      closes_at: raw.close_time ?? raw.latest_expiration_time ?? null,
      resolved,
      resolution,
      resolved_at: null,
      fetched_at: fetchedAt.toISOString(),
      cache_hit: false,
      data_age_seconds: secondsSince(fetchedAt.toISOString(), fetchedAt),
    },
    platform_raw: raw,
    warnings,
  };
}

export function normalizeKalshiBatch(rawMarkets: KalshiMarketRaw[], fetchedAt: Date): NormalizationBatch {
  const normalized: NormalizerResult[] = [];
  const errors: NormalizerError[] = [];

  for (const raw of rawMarkets) {
    try {
      normalized.push(normalizeKalshiMarket(raw, fetchedAt));
    } catch (error) {
      errors.push({
        platform_id: raw.ticker,
        error: error instanceof Error ? error.message : String(error),
        raw_data: raw,
      });
    }
  }

  return { normalized, errors };
}

function deriveKalshiYesPrice(raw: KalshiMarketRaw, warnings: string[]): number {
  const lastPrice = parseKalshiDollars(raw.last_price_dollars);
  if (lastPrice !== null) {
    return assertPriceBounds(lastPrice, raw.ticker, 'last_price_dollars');
  }

  const yesBid = parseKalshiDollars(raw.yes_bid_dollars);
  const yesAsk = parseKalshiDollars(raw.yes_ask_dollars);

  if (yesBid !== null && yesAsk !== null) {
    return assertPriceBounds(roundPrice((yesBid + yesAsk) / 2), raw.ticker, 'midpoint');
  }

  if (yesBid !== null) {
    warnings.push('Missing yes_ask_dollars; using yes_bid_dollars as yes_price');
    return assertPriceBounds(yesBid, raw.ticker, 'yes_bid_dollars');
  }

  if (yesAsk !== null) {
    warnings.push('Missing yes_bid_dollars; using yes_ask_dollars as yes_price');
    return assertPriceBounds(yesAsk, raw.ticker, 'yes_ask_dollars');
  }

  throw new Error(`Kalshi market ${raw.ticker} is missing usable price fields`);
}

function deriveKalshiSpread(raw: KalshiMarketRaw): number | null {
  const yesBid = parseKalshiDollars(raw.yes_bid_dollars);
  const yesAsk = parseKalshiDollars(raw.yes_ask_dollars);

  if (yesBid === null || yesAsk === null) {
    return null;
  }

  return roundPrice(Math.max(0, yesAsk - yesBid));
}

function normalizeKalshiCategory(raw: KalshiMarketRaw): MarketCategory {
  const seriesTicker = raw.series_ticker?.toLowerCase() ?? '';
  const category = raw.category?.toLowerCase().trim() ?? '';
  const title = raw.title?.toLowerCase() ?? '';

  if (seriesTicker.startsWith('kxfed') || category.includes('fed')) return 'fed_policy';
  if (category.includes('economic') || category.includes('inflation') || title.includes('cpi')) return 'economics';
  if (category.includes('financial') || category.includes('stock') || title.includes('s&p') || title.includes('nasdaq')) return 'financial_markets';
  if (category.includes('politic') || title.includes('election')) return 'us_politics';
  if (category.includes('geo') || title.includes('ukraine') || title.includes('china')) return 'geopolitics';
  if (category.includes('tech') || title.includes('apple') || title.includes('nvidia')) return 'technology';
  if (category.includes('crypto') || title.includes('bitcoin') || title.includes('ethereum')) return 'crypto';
  if (category.includes('sport') || title.includes('nba') || title.includes('nfl')) return 'sports';
  if (category.includes('climate') || category.includes('weather') || title.includes('hurricane')) return 'climate';
  if (category.includes('entertain') || title.includes('oscar')) return 'entertainment';
  return 'other';
}

function mapKalshiStatus(status: KalshiMarketRaw['status']): MarketStatus {
  switch (status) {
    case 'settled':
      return 'resolved';
    case 'closed':
      return 'closed';
    case 'initialized':
    case 'unopened':
    case 'open':
    case 'active':
      return 'open';
  }
}

function mapKalshiResult(result: KalshiMarketRaw['result']): ResolutionOutcome | null {
  if (result === 'yes') return 'YES';
  if (result === 'no') return 'NO';
  return null;
}

function roundPrice(value: number): number {
  return Number(value.toFixed(6));
}

function assertPriceBounds(value: number, ticker: string, fieldName: string): number {
  if (value < 0 || value > 1) {
    throw new Error(`Kalshi market ${ticker} has out-of-range ${fieldName}: ${value}`);
  }

  return roundPrice(value);
}
