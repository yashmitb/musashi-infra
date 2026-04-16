/**
 * show-event-intelligence.ts
 *
 * Smoke-test the event layer against real DB data.
 *
 * Usage:
 *   npm run event:show                          # top 5 events by liquidity
 *   npm run event:show -- --event-id FED-SEP    # one specific event_id
 *   npm run event:show -- --category fed_policy # all markets in a category (first 50)
 *   npm run event:show -- --limit 10            # show more events
 */

import { createClient } from '@supabase/supabase-js';

import { clusterMarkets } from '../src/lib/event-clustering.js';
import { buildEventIntelligence } from '../src/lib/event-intelligence.js';
import { loadRuntimeEnv } from '../src/lib/runtime-env.js';
import type { MusashiMarket } from '../src/types/market.js';
import type { MarketSnapshot } from '../src/types/storage.js';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const filterEventId = getArg('--event-id');
const filterCategory = getArg('--category');
const limit = Number(getArg('--limit') ?? '5');

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const env = await loadRuntimeEnv(new URL('../.env', import.meta.url));

if (!env['SUPABASE_URL'] || !env['SUPABASE_SERVICE_KEY']) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
}

const supabase = createClient(env['SUPABASE_URL'], env['SUPABASE_SERVICE_KEY'], {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// Fetch markets
// ---------------------------------------------------------------------------

// Select only columns that exist in the DB — fetched_at / cache_hit / data_age_seconds
// are API-layer fields on MusashiMarket but are never stored.
// ORDER BY is done in JS after clustering — avoid sorting at the DB level since
// there is no index on liquidity and a full-table sort causes a statement timeout.
let marketQuery = supabase
  .from('markets')
  .select(
    'id,platform,platform_id,event_id,series_id,title,description,category,url,' +
    'yes_price,no_price,volume_24h,open_interest,liquidity,spread,status,' +
    'created_at,closes_at,resolved,resolution,resolved_at,last_ingested_at',
  )
  .eq('is_active', true);

if (filterEventId !== undefined) {
  marketQuery = marketQuery.eq('event_id', filterEventId).limit(200);
} else if (filterCategory !== undefined) {
  marketQuery = marketQuery.eq('category', filterCategory).limit(100);
} else {
  // Default: fetch enough markets to form meaningful clusters, cap to avoid timeout
  marketQuery = marketQuery.limit(limit * 20);
}

const { data: marketRows, error: marketError } = await marketQuery;

if (marketError) {
  throw new Error(`Failed to fetch markets: ${marketError.message}`);
}

if (!marketRows || marketRows.length === 0) {
  console.log(JSON.stringify({ message: 'No active markets found for the given filters.' }, null, 2));
  process.exit(0);
}

// Map DB rows → MusashiMarket by filling in API-only fields with neutral defaults.
const markets: MusashiMarket[] = (marketRows as unknown as Array<Record<string, unknown>>).map((row) => ({
  ...(row as Omit<MusashiMarket, 'fetched_at' | 'cache_hit' | 'data_age_seconds'>),
  fetched_at: (row['last_ingested_at'] as string) ?? new Date().toISOString(),
  cache_hit: false,
  data_age_seconds: 0,
}));
console.error(`Fetched ${markets.length} market(s) from DB`);

// ---------------------------------------------------------------------------
// Fetch snapshots (last 8 days to cover 7d change calculation)
// ---------------------------------------------------------------------------

const marketIds = markets.map((m) => m.id);
const since = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

const { data: snapshotRows, error: snapshotError } = await supabase
  .from('market_snapshots')
  .select('market_id,snapshot_time,yes_price,no_price,volume_24h,open_interest,liquidity,spread,source,fetch_latency_ms,created_at')
  .in('market_id', marketIds)
  .gte('snapshot_time', since)
  .order('snapshot_time', { ascending: true });

if (snapshotError) {
  throw new Error(`Failed to fetch snapshots: ${snapshotError.message}`);
}

const snapshots = (snapshotRows ?? []) as MarketSnapshot[];
console.error(`Fetched ${snapshots.length} snapshot(s) for those markets`);

// ---------------------------------------------------------------------------
// Fetch historical resolution count by category (used for trust context)
// ---------------------------------------------------------------------------

const categories = [...new Set(markets.map((m) => m.category))];
const resolutionCounts: Record<string, number> = {};

for (const category of categories) {
  const { count, error } = await supabase
    .from('market_resolutions')
    .select('market_id', { count: 'exact', head: true })
    .eq('market_id', supabase.from('markets').select('id').eq('category', category) as unknown as string);

  // Simplified: count all resolutions in the table and attribute per category via a join
  // For v1 we just count all resolutions as a rough trust signal
  void count;
  void error;
  resolutionCounts[category] = 0;
}

// Simpler: just get total resolution count across all markets we loaded
const { count: totalResolutions } = await supabase
  .from('market_resolutions')
  .select('market_id', { count: 'exact', head: true })
  .in('market_id', marketIds);

const resolvedCount = totalResolutions ?? 0;

// ---------------------------------------------------------------------------
// Build event objects
// ---------------------------------------------------------------------------

const clusters = clusterMarkets(markets);
console.error(`Formed ${clusters.length} cluster(s)`);

// Sort clusters by primary market liquidity descending, take top N
const eventObjects = clusters
  .map((cluster) => buildEventIntelligence(cluster, snapshots, resolvedCount))
  .sort((a, b) => {
    const la = a.trust_context.liquidity ?? -1;
    const lb = b.trust_context.liquidity ?? -1;
    return lb - la;
  })
  .slice(0, limit);

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

console.log(JSON.stringify(eventObjects, null, 2));
