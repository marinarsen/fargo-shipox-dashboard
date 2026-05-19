# ETL Starter

This folder will hold the shared data pipeline for the unified dashboard.

## Planned flow

1. Read client config.
2. Export orders from Shipox for each client.
3. Enrich first attempt timestamps from Mongo.
4. Normalize all orders into one shared schema.
5. Build dashboard KPIs and alerts.
6. Save one snapshot JSON for the frontend.

## Why not query Shipox directly from the browser

- secrets would leak
- browser requests would be slower and harder to control
- alert logic belongs on the backend side

## Current starter files

- [`etl/config/clients.sample.json`](D:/Арсен/Codex/fargo-shipox-dashboard/etl/config/clients.sample.json)
- [`etl/scripts/collect_snapshot.mjs`](D:/Арсен/Codex/fargo-shipox-dashboard/etl/scripts/collect_snapshot.mjs)

## First milestone

Replace sample snapshot generation with real normalized data from:

- TEZ-like Shipox exporter logic
- TEZ-like Mongo first-attempt logic
- shared cross-client KPI builders
