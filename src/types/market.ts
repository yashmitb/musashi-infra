import { z } from 'zod';

export const MARKET_PLATFORMS = ['kalshi', 'polymarket'] as const;
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
export const MARKET_STATUSES = ['open', 'closed', 'resolved'] as const;
export const RESOLUTION_OUTCOMES = ['YES', 'NO'] as const;

// Zod schemas for runtime validation
export const MarketPlatformSchema = z.enum(MARKET_PLATFORMS);
export const MarketCategorySchema = z.enum(MARKET_CATEGORIES);
export const MarketStatusSchema = z.enum(MARKET_STATUSES);
export const ResolutionOutcomeSchema = z.enum(RESOLUTION_OUTCOMES).nullable();

export const MusashiMarketSchema = z.object({
  id: z.string().startsWith('musashi-'),
  platform: MarketPlatformSchema,
  platform_id: z.string().min(1),
  event_id: z.string().nullable(),
  series_id: z.string().nullable(),
  title: z.string().min(1),
  description: z.string().nullable(),
  category: MarketCategorySchema,
  url: z.string().url(),
  yes_price: z.number().min(0).max(1),
  no_price: z.number().min(0).max(1),
  volume_24h: z.number().nonnegative(),
  open_interest: z.number().nullable(),
  liquidity: z.number().nullable(),
  spread: z.number().nullable(),
  status: MarketStatusSchema,
  created_at: z.string().nullable(),
  closes_at: z.string().nullable(),
  resolved: z.boolean(),
  resolution: ResolutionOutcomeSchema,
  resolved_at: z.string().nullable(),
  fetched_at: z.string(),
  cache_hit: z.boolean(),
  data_age_seconds: z.number().nonnegative(),
}).refine(
  (data) => Math.abs(data.yes_price + data.no_price - 1) < 0.001,
  { message: 'yes_price and no_price must sum to approximately 1' }
);

// Inferred types from schemas
export type MarketPlatform = z.infer<typeof MarketPlatformSchema>;
export type MarketCategory = z.infer<typeof MarketCategorySchema>;
export type MarketStatus = z.infer<typeof MarketStatusSchema>;
export type ResolutionOutcome = NonNullable<z.infer<typeof ResolutionOutcomeSchema>>;
export type MusashiMarket = z.infer<typeof MusashiMarketSchema>;

// Type guard using Zod validation
export function isMusashiMarket(value: unknown): value is MusashiMarket {
  return MusashiMarketSchema.safeParse(value).success;
}

// Validate and parse with detailed error messages
export function parseMusashiMarket(value: unknown): MusashiMarket {
  return MusashiMarketSchema.parse(value);
}
