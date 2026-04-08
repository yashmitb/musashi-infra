# Stage 0 Architecture

## Goal

Build a Kalshi-first data substrate that can run unattended, preserve every hourly snapshot, and provide a trustworthy base for later calibration and agent tooling.

## Non-goals

- Polymarket ingestion
- product API handlers
- MCP tooling
- strategy or intelligence logic
- orderbook or trade-history ingestion

## Boundaries

### `src/api/`

Owns raw Kalshi HTTP access and normalization into the canonical `MusashiMarket` shape.

### `src/db/`

Owns the only code allowed to write to Supabase-backed tables.

### `src/jobs/`

Owns orchestration, retries at the job level, and ingestion logging.

### `src/types/`

Owns durable contracts:

- raw Kalshi response types
- canonical Musashi market types
- snapshot and resolution record types
- API freshness metadata shapes

## Data Flow

1. `KalshiClient` fetches paginated market payloads from the trading API.
2. `KalshiNormalizer` converts raw payloads into `MusashiMarket`.
3. Storage layer upserts registry rows and inserts hourly snapshots idempotently.
4. Resolution job re-fetches unresolved markets near or after close.
5. Ingestion and source-health tables provide observability and gap detection inputs.

## Constraints

- one snapshot per market per hour
- `no_price` is always derived
- raw payloads are retained for forward compatibility
- unresolved and resolved state changes are explicit
- source availability is recorded independently from market availability
