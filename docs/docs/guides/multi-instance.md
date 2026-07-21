---
sidebar_position: 4
---

# Multi-instance deployment

LoadFlux runs **in-process** in each Node.js container. When you run multiple replicas behind a load balancer (AWS App Runner, Kubernetes, ECS, etc.), each instance records only the traffic it serves unless **cluster mode** is enabled.

## Requirements

- **MongoDB** as the shared database (`cluster` mode does not support multi-writer SQLite)
- **Cluster mode** enabled in config
- A **unique instance ID** per container (auto-detected from `HOSTNAME` on App Runner)

## Quick setup (AWS App Runner)

```typescript
import { loadflux } from "loadflux";

app.use(
  loadflux({
    database: {
      adapter: "mongodb",
      connectionString: process.env.MONGODB_URI!,
    },
    cluster: {
      enabled: true,
      // instanceId optional — defaults to LOADFLUX_INSTANCE_ID || HOSTNAME || os.hostname()
      // Prefer a stable LOADFLUX_INSTANCE_ID so instance lists do not churn across deploys.
    },
    // Only when behind a trusted reverse proxy that *overwrites* X-Forwarded-For.
    // Do not enable if clients can reach the app directly — forged headers bypass login rate limits.
    // Not required for cluster aggregation itself.
    trustProxy: true,
    excludeRoutes: ["/health"],
  }),
);
```

### Environment variables

| Variable | Purpose |
|----------|---------|
| `MONGODB_URI` | Shared MongoDB connection string (Atlas, DocumentDB, etc.) |
| `LOADFLUX_INSTANCE_ID` | Optional explicit per-task ID (prefer stable IDs; App Runner `HOSTNAME` is usually enough) |
| `LOADFLUX_TRUST_PROXY` | Set to `1` **only** behind App Runner / ALB that overwrites `X-Forwarded-For` (login rate limiting). Not required for cluster mode. |

**Trust boundary:** Any process with the MongoDB URI can write metrics under any `instance_id`. Treat DB credentials as high-value; use least-privilege users.

App Runner does **not** provide session affinity. Cluster mode fixes dashboard flickering by serving **aggregated live metrics from MongoDB**, so any replica returns the same numbers.

## What cluster mode changes

| Metric | Single instance | Cluster mode |
|--------|-----------------|--------------|
| Live RPS / RPM | In-memory on serving container | Sum of endpoint metrics (last 60s / aggregation window) |
| Total Requests / Error Rate | O(1) lifetime counters (seeded once, then incremented on flush; not reduced by retention) | Same counters — cluster-wide |
| Live CPU / RAM / heap | Local container | Aggregated across all instances |
| Historical endpoints / errors | DB (already merged) | Same |
| System / App Metrics charts | Per-sample rows | Cluster aggregate by default; optional instance filter in UI |

**Total Requests** on the live dashboard is tracked via O(1) lifetime counters (seeded once from existing `endpoint_metrics`, then incremented on each flush). Retention cleanup does **not** decrease these counters.

## API

Cluster-related HTTP query behavior is documented in [REST API](/docs/api-reference/rest-api). Summary:

- `GET /api/instances?from=&to=` — distinct instance IDs in range
- `GET /api/system?instance=<id>` — filter to one instance; omit `instance` for cluster aggregate when cluster mode is on
- `GET /api/process?instance=<id>` — same for process metrics
- `max_points` — server-side downsampling for long system/process series

## Local multi-instance demo

The repo includes a small round-robin proxy and PM2 config for testing cluster mode against local MongoDB:

- `examples/load-balancer.mjs` — distributes requests across upstream ports
- `ecosystem.config.cjs` — starts the load balancer plus three `examples/test-server.mjs` tasks with `cluster.enabled` and distinct `HOSTNAME` values

```bash
npm run build
# MongoDB on localhost:27017, then:
npx pm2 start ecosystem.config.cjs
# Dashboard via load balancer (default port 3456)
```

The test server enables cluster mode when `LOADFLUX_CLUSTER=1` (demo only — production apps should set `cluster: { enabled: true }` in code).

## Known limitations

- **Percentiles** (p95/p99) are approximate across instances (`MAX` across windows, not true global percentiles)
- **RPS** in cluster mode is a rolling average over the aggregation window (~5s), not per-second
- **SSE connection count** is per serving instance (labeled "SSE (this instance)" in the dashboard)
- **Login rate limiting** remains per-instance in memory
- **Total Requests** is a monotonic counter (not reduced when retention deletes old windows)

## Single-instance development

Leave `cluster.enabled` unset (default `false`). SQLite works as usual; live RPS/RPM stay in-memory while **Total Requests** uses lifetime counters (with a short in-memory fallback before the first flush).
