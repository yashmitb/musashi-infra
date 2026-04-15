import { sleep } from '../lib/time.js';
import type {
  KalshiEventRaw,
  KalshiEventsResponse,
  KalshiMarketRaw,
  KalshiMarketResponse,
  KalshiMarketsResponse,
} from '../types/kalshi-raw.js';

// Global rate limiter singleton to coordinate across all KalshiClient instances
class GlobalRateLimiter {
  private lastRequestStartedAt = 0;
  private readonly rateLimitMs: number;

  constructor(rateLimitMs: number) {
    this.rateLimitMs = rateLimitMs;
  }

  async wait(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestStartedAt;
    const remaining = this.rateLimitMs - elapsed;

    if (remaining > 0) {
      await sleep(remaining);
    }

    this.lastRequestStartedAt = Date.now();
  }
}

// Singleton instance for Kalshi API rate limiting (110ms between requests = ~9 req/sec)
const globalKalshiRateLimiter = new GlobalRateLimiter(110);

export interface KalshiClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  rateLimitMs?: number;
  fetchImpl?: typeof fetch;
}

export interface FetchAllMarketsResult {
  markets: KalshiMarketRaw[];
  errors: string[];
  fetch_ms: number;
}

export interface FetchMarketsPageOptions {
  cursor?: string | null;
  limit?: number;
  status?: 'open' | 'closed' | 'settled';
}

export interface KalshiMarketsPage {
  cursor: string;
  markets: KalshiMarketRaw[];
  fetch_ms: number;
}

export interface IterateMarketsOptions extends FetchMarketsPageOptions {
  maxPages?: number;
}

export class KalshiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: KalshiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'https://api.elections.kalshi.com/trade-api/v2';
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchImpl = options.fetchImpl ?? fetch;

    // Note: rateLimitMs option is ignored; we use the global rate limiter instead
    // This ensures proper rate limiting across all client instances
  }

  async fetchAllMarkets(): Promise<FetchAllMarketsResult> {
    const startedAt = Date.now();
    const markets: KalshiMarketRaw[] = [];
    const errors: string[] = [];
    let cursor = '';

    while (true) {
      const params = new URLSearchParams({
        limit: '1000',
        status: 'open',
      });

      if (cursor !== '') {
        params.set('cursor', cursor);
      }

      try {
        const response = await this.fetchWithRetry<KalshiMarketsResponse>(`/markets?${params.toString()}`);
        markets.push(...response.markets);
        cursor = response.cursor;
      } catch (error) {
        errors.push(String(error));
        break;
      }

      if (cursor === '') {
        break;
      }
    }

    return {
      markets,
      errors,
      fetch_ms: Date.now() - startedAt,
    };
  }

  async fetchMarketsPage(options: FetchMarketsPageOptions = {}): Promise<KalshiMarketsPage> {
    const startedAt = Date.now();
    const params = new URLSearchParams({
      limit: String(options.limit ?? 1000),
      status: options.status ?? 'open',
    });

    if (options.cursor) {
      params.set('cursor', options.cursor);
    }

    const response = await this.fetchWithRetry<KalshiMarketsResponse>(`/markets?${params.toString()}`);
    return {
      cursor: response.cursor,
      markets: response.markets,
      fetch_ms: Date.now() - startedAt,
    };
  }

  async *iterateMarkets(options: IterateMarketsOptions = {}): AsyncGenerator<KalshiMarketsPage> {
    const maxPages = options.maxPages ?? 250;
    let pageCount = 0;
    let cursor = options.cursor ?? '';
    const seenCursors = new Set<string>();

    while (true) {
      if (pageCount >= maxPages) {
        throw new KalshiPaginationBudgetError(`Kalshi market pagination exceeded this run budget of ${maxPages} pages`);
      }

      const pageOptions: FetchMarketsPageOptions = {};
      if (cursor !== '') {
        pageOptions.cursor = cursor;
      }
      if (options.limit !== undefined) {
        pageOptions.limit = options.limit;
      }
      if (options.status !== undefined) {
        pageOptions.status = options.status;
      }

      const page = await this.fetchMarketsPage(pageOptions);

      pageCount += 1;

      if (page.cursor !== '' && seenCursors.has(page.cursor)) {
        throw new KalshiPaginationCursorError(`Kalshi market pagination cursor repeated at page ${pageCount}`);
      }

      if (page.cursor !== '') {
        seenCursors.add(page.cursor);
      }

      yield page;

      if (page.cursor === '') {
        break;
      }

      cursor = page.cursor;
    }
  }

  async fetchMarket(ticker: string): Promise<KalshiMarketRaw | null> {
    try {
      const response = await this.fetchWithRetry<KalshiMarketResponse>(`/markets/${encodeURIComponent(ticker)}`);
      return response.market;
    } catch (error) {
      if (error instanceof KalshiHttpError && error.status === 404) {
        return null;
      }

      throw error;
    }
  }

  async fetchAllEvents(): Promise<KalshiEventRaw[]> {
    const events: KalshiEventRaw[] = [];
    let cursor = '';

    while (true) {
      const params = new URLSearchParams({ limit: '1000' });

      if (cursor !== '') {
        params.set('cursor', cursor);
      }

      const response = await this.fetchWithRetry<KalshiEventsResponse>(`/events?${params.toString()}`);
      events.push(...response.events);
      cursor = response.cursor;

      if (cursor === '') {
        break;
      }
    }

    return events;
  }

  private async fetchWithRetry<T>(path: string, retries = this.maxRetries): Promise<T> {
    try {
      return await this.fetchJson<T>(path);
    } catch (error) {
      if (retries <= 0 || !isRetryableKalshiError(error)) {
        throw error;
      }

      const attemptIndex = this.maxRetries - retries;
      await sleep(1000 * 2 ** attemptIndex);
      return this.fetchWithRetry<T>(path, retries - 1);
    }
  }

  private async fetchJson<T>(path: string): Promise<T> {
    // Use global rate limiter to coordinate across all instances
    await globalKalshiRateLimiter.wait();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new KalshiHttpError(response.status, `${response.status} ${response.statusText}`, path);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (isAbortError(error)) {
        throw new KalshiTimeoutError(`Kalshi request timed out after ${this.timeoutMs}ms: ${path}`);
      }

      if (error instanceof Error) {
        throw error;
      }

      throw new Error(`Unknown Kalshi fetch error for ${path}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export class KalshiHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly path: string,
  ) {
    super(message);
    this.name = 'KalshiHttpError';
  }
}

export class KalshiTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KalshiTimeoutError';
  }
}

export class KalshiPaginationBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KalshiPaginationBudgetError';
  }
}

export class KalshiPaginationCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KalshiPaginationCursorError';
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isRetryableKalshiError(error: unknown): boolean {
  if (error instanceof KalshiTimeoutError) {
    return true;
  }

  if (error instanceof KalshiHttpError) {
    return error.status >= 500 || error.status === 429;
  }

  return error instanceof TypeError;
}
