---
sidebar_position: 2
---

# Database Configuration

LoadFlux supports two database backends: **SQLite** (default) and **MongoDB** (optional).

## SQLite (default)

Zero-config. LoadFlux creates a SQLite database file automatically.

```typescript
// Uses ./loadflux.db by default
app.use(loadflux());

// Custom path
app.use(loadflux({
  database: {
    adapter: "sqlite",
    connectionString: "./data/monitoring.db",
  },
}));
```

### How it works

- Uses `better-sqlite3` for synchronous, fast operations
- Schema migrations run automatically on startup (additive only — no destructive changes)
- Database version is tracked in the `settings` table
- All inserts use batched transactions for minimal disk I/O (single fsync per flush)

### When to use SQLite

- Development and staging environments
- When you don't want external database dependencies
- Most use cases — SQLite handles thousands of inserts per second

## MongoDB (optional)

For applications already using MongoDB, or when you prefer a networked database over a local file.

### Setup

Install the MongoDB driver:

```bash
npm install mongodb
```

Configure LoadFlux:

```typescript
app.use(loadflux({
  database: {
    adapter: "mongodb",
    connectionString: "mongodb://localhost:27017/loadflux",
  },
}));
```

### How it works

- Uses the official `mongodb` driver (peer dependency `>= 5`)
- Collections mirror the SQLite schema: `system_metrics`, `process_metrics`, `endpoint_metrics`, `error_log`, `settings`, `auth`
- Indexes created automatically: `{ timestamp: 1 }` and `{ instance_id: 1, timestamp: 1 }` on metric collections, `{ method: 1, path: 1 }` on `endpoint_metrics`
- Bulk insert via `insertMany` for aggregator flushes

### When to use MongoDB

- Applications already running MongoDB
- When you need to query metrics data externally

## Switching databases

You can switch between SQLite and MongoDB at any time by changing the configuration. Historical data from the previous adapter won't be migrated — the new database starts fresh.

## Data retention

Both adapters use the same retention logic:

- A daily cron job (configurable via `retention.cronExpression`) calls `deleteOlderThan` on all metric collections/tables
- The cutoff uses `retention_days` from dashboard settings when set, otherwise `retention.days` (default **90**)
- **Lifetime total request/error counters** are stored separately and are **not** decreased when old metric rows are deleted
