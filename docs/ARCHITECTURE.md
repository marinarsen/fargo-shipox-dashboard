# Unified Dashboard Architecture

## Why a separate web app

TEZ and Oriflame already contain good business logic, but each project is tied to its own sheet structure and update flow.

For the new shared dashboard we want:

- one screen for all clients
- no direct dependency on Google Sheets layout
- no browser exposure of Shipox or Mongo secrets
- one reusable KPI model for every client

So the new app should be:

- separate repo
- separate secrets
- separate scheduler
- separate DEV and PROD outputs

## Recommended MVP design

### 1. Data collection layer

Node ETL scripts pull data from:

- Shipox API
- MongoDB webhook history for first delivery attempt

Input is per client, because:

- some clients need different `customer_id`
- some may need different city mapping
- some may need custom status interpretation

### 2. Normalization layer

Each order should be converted into one shared internal shape:

- `client_key`
- `order_number`
- `status`
- `created_at`
- `status_updated_at`
- `first_attempt_at`
- `source_city`
- `destination_city`
- `current_city_or_warehouse`
- `is_final`
- `is_returned`
- `is_failed`
- `is_active`

This is the most important layer because it lets us calculate all KPIs once.

### 3. Metrics layer

From normalized orders we calculate:

- active orders
- delivery time
- time to first attempt
- no attempt 2+ days
- stale status orders
- tails by aging bucket
- returns
- failed deliveries
- weekly comparison
- top bad clients
- top bad cities
- alert rules

### 4. Snapshot layer

The ETL writes one clean snapshot JSON:

- `artifacts/dev/latest-snapshot.json`
- `artifacts/prod/latest-snapshot.json`

This is what the web app reads.

Benefits:

- frontend stays fast and simple
- debugging becomes much easier
- safe secret separation
- GitHub Actions can build and publish without exposing credentials to users

### 5. Web app layer

The React app should read the latest snapshot and show:

- top KPI cards
- client table
- city table
- weekly trends
- alert list
- filters

In MVP, filters can be frontend-only if the snapshot already contains enough data.

## DEV / PROD model

### DEV

- uses DEV secrets
- writes DEV snapshot
- used to test new KPI logic
- safe place for new clients and mapping fixes

### PROD

- uses PROD secrets
- writes PROD snapshot
- only enabled after DEV numbers are checked

## Secrets model

Store secrets only in the new repo:

- `SHIPOX_USERNAME`
- `SHIPOX_PASSWORD`
- `SHIPOX_ID_TOKEN`
- `MONGODB_URI`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`

Optional later:

- dashboard hosting token
- Telegram alert token

Do not copy secrets into frontend code or commit them into files.

## Scheduler model

For MVP, keep it simple:

- GitHub Actions runs ETL on schedule
- build DEV and PROD separately
- upload snapshot artifacts or publish them to hosting storage

This reuses a pattern that already works in the existing projects.

## What we reuse from TEZ and Oriflame

- Shipox authentication and export flow
- Mongo first-attempt enrichment
- FAST vs DEEP window idea
- status mapping patterns
- GitHub Actions scheduling pattern
- DEV / PROD separation

## What we do not reuse directly

- old Google Sheet layouts
- Apps Script rendering logic
- client-specific sheet formulas

Those belong to the old dashboards, not to the new shared control tower.
