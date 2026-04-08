# ADR 0001: Kalshi-first Stage 0

## Status

Accepted

## Context

Musashi's moat begins with durable market history and calibration data. The first infrastructure layer must prioritize the regulated Kalshi exchange and avoid carrying prototype assumptions from older product repos into the new data foundation.

## Decision

Stage 0 will be built as a new repository with a Kalshi-only scope:

- full open-market ingestion from the Kalshi trading API
- hourly idempotent snapshots
- five-minute resolution checks
- structured ingestion health logging

Polymarket is deferred until the Kalshi substrate is stable.

## Consequences

- the schema and type system remain simpler during the highest-risk phase
- the resulting data is aligned with Musashi's institutional positioning
- future multi-source expansion will happen on top of a stable canonical core
- older repos can consume this repository later, but do not define its contracts
