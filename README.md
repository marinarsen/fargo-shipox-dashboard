# Fargo / Shipox Unified Dashboard

Shared web dashboard for operational delivery control across all Fargo / Shipox clients.

This project is intentionally separate from:

- `D:\Арсен\Codex\Tezbank-dashboard`
- `D:\Арсен\Codex\oriflame`

Those projects are references only. Their current PROD flows stay untouched.

## What this repo is for

The goal is one normal web dashboard where operations can see:

- all clients in one place
- KPIs by client
- KPIs by city
- delivery time
- time to first attempt
- no attempt 2+ days
- stale status orders
- old tails
- returns
- delivery failed
- pipeline / active orders
- comparison vs previous week
- alerts for bad clients and bad cities
- filters by period, client, city, status

## MVP architecture in simple words

1. A separate ETL job reads Shipox and Mongo.
2. That ETL calculates one clean dashboard snapshot.
3. The web app reads only that prepared snapshot.
4. Secrets stay only in the ETL environment, not in the browser.

This means:

- safer secrets handling
- easier DEV / PROD split
- faster UI
- easier debugging when numbers look wrong

## Proposed stack

- Frontend: `React + TypeScript + Vite`
- Snapshot builder: Node.js scripts in `etl/`
- Output for MVP: versioned JSON snapshot files
- Scheduler for MVP: GitHub Actions
- DEV / PROD split: separate workflows, separate secrets, separate snapshot outputs

Later, if needed, we can move snapshot storage to:

- Mongo collection
- S3 / Cloud Storage
- lightweight Postgres

But JSON snapshots are the fastest safe MVP.

## Project structure

- [`src/App.tsx`](D:/Арсен/Codex/fargo-shipox-dashboard/src/App.tsx) - first dashboard screen
- [`src/data/sampleSnapshot.ts`](D:/Арсен/Codex/fargo-shipox-dashboard/src/data/sampleSnapshot.ts) - sample DEV snapshot
- [`src/types.ts`](D:/Арсен/Codex/fargo-shipox-dashboard/src/types.ts) - shared dashboard data contract
- [`etl/README.md`](D:/Арсен/Codex/fargo-shipox-dashboard/etl/README.md) - ETL plan
- [`etl/scripts/collect_snapshot.mjs`](D:/Арсен/Codex/fargo-shipox-dashboard/etl/scripts/collect_snapshot.mjs) - starter ETL CLI
- [`docs/ARCHITECTURE.md`](D:/Арсен/Codex/fargo-shipox-dashboard/docs/ARCHITECTURE.md) - architecture notes

## Run locally

```powershell
cd D:\Арсен\Codex\fargo-shipox-dashboard
npm install
npm run dev
```

## Sample ETL run

```powershell
node .\etl\scripts\collect_snapshot.mjs --env dev --sample
```

This writes a safe sample snapshot to `artifacts/dev/latest-snapshot.json`.

## What is already implemented

- new isolated web project
- first dashboard layout
- sample multi-client snapshot contract
- ETL folder and starter CLI
- client config template
- DEV / PROD environment template

## What comes next

1. Move TEZ and Oriflame reusable logic into a shared normalized ETL layer.
2. Add real client configs.
3. Build Shipox extractors per client.
4. Add Mongo first-attempt enrichment.
5. Compute shared KPI blocks and alerts.
6. Publish DEV snapshot automatically.
7. Only after DEV checks, wire PROD.
# Fargo / Shipox Dashboard

## Public page deployment

The dashboard is a static Vite app. GitHub Pages can host it after the repository is created and pushed.

Required GitHub repository secret for live refresh:

- `MONGODB_URI`

Optional later secrets for Shipox API enrichment:

- `SHIPOX_USERNAME`
- `SHIPOX_PASSWORD`
- `SHIPOX_ID_TOKEN`
- `SHIPOX_MARKETPLACE_ID`

Deployment workflow:

- `.github/workflows/deploy-pages.yml` builds the app and deploys `dist` to GitHub Pages.
- If `MONGODB_URI` exists, the workflow refreshes `public/generatedSnapshot.json` during deploy.
- If `MONGODB_URI` is absent, it deploys the committed snapshot file.

Recommended update cadence:

- `FAST`: every 30-60 minutes for the recent operational window.
- `DEEP`: once nightly for the full 2026 snapshot and older tails.
