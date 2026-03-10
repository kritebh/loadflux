---
sidebar_position: 1
---

# Configuration Options

All configuration is optional. LoadFlux works with zero config using sensible defaults.

## `LoadFluxConfig`

```typescript
interface LoadFluxConfig {
  path?: string;
  framework?: "express" | "fastify";
  database?: {
    adapter?: "sqlite" | "mongodb";
    connectionString?: string;
  };
  auth?: {
    username: string;
    password: string;
  };
  collection?: {
    systemInterval?: number;
    aggregationWindow?: number;
  };
  retention?: {
    days?: number;
    cronExpression?: string;
  };
  slowRequestThreshold?: number;
  excludeRoutes?: string[];
}
```

## Options reference

### `path`

| | |
|---|---|
| **Type** | `string` |
| **Default** | `"/loadflux"` |

The URL path where the dashboard is served. Must start with `/`.

```typescript
loadflux({ path: "/monitor" })
// Dashboard at http://localhost:3000/monitor
```

### `framework`

| | |
|---|---|
| **Type** | `"express" \| "fastify"` |
| **Default** | Auto-detected |

You don't need to set this — it's automatically set by `loadflux()` (Express) or `loadfluxFastify()` (Fastify).

### `database`

| | |
|---|---|
| **Type** | `{ adapter?: string; connectionString?: string }` |

#### `database.adapter`

| | |
|---|---|
| **Type** | `"sqlite" \| "mongodb"` |
| **Default** | `"sqlite"` |

#### `database.connectionString`

| | |
|---|---|
| **Type** | `string` |
| **Default** | `"./loadflux.db"` (SQLite) or `"mongodb://localhost:27017/loadflux"` (MongoDB) |

For SQLite, this is the file path. For MongoDB, this is the connection URI.

### `auth`

| | |
|---|---|
| **Type** | `{ username: string; password: string } \| undefined` |
| **Default** | `undefined` |

When set, the dashboard requires login. Credentials are hashed with bcrypt and stored in the database. If the password changes between server restarts (e.g., updated in `.env`), LoadFlux automatically syncs the hash on startup.

When not set, the dashboard shows a setup prompt on first visit.

### `collection.systemInterval`

| | |
|---|---|
| **Type** | `number` (milliseconds) |
| **Default** | `5000` |
| **Minimum** | `1000` |

How often system metrics (CPU, RAM, disk, network) are collected.

### `collection.aggregationWindow`

| | |
|---|---|
| **Type** | `number` (milliseconds) |
| **Default** | `5000` |
| **Minimum** | `1000` |

How often buffered request metrics are flushed to the database. During each flush, percentiles (p50/p90/p95/p99) are computed in-memory.

### `retention.days`

| | |
|---|---|
| **Type** | `number` |
| **Default** | `90` |
| **Minimum** | `1` |

Number of days to keep metrics data. A daily cron job deletes older records.

### `retention.cronExpression`

| | |
|---|---|
| **Type** | `string` (cron expression) |
| **Default** | `"0 2 * * *"` (2:00 AM daily) |

When the retention cleanup runs.

### `slowRequestThreshold`

| | |
|---|---|
| **Type** | `number` (milliseconds) |
| **Default** | `500` |
| **Minimum** | `0` |

Requests exceeding this duration appear in the "Slow Requests" section.

### `excludeRoutes`

| | |
|---|---|
| **Type** | `string[]` |
| **Default** | `[]` |

URL paths to exclude from metrics collection. Useful for health checks or internal routes.

Supports:
- **Exact matches**: the path must match exactly.
- **Prefix patterns**: any entry ending with `*` is treated as `startsWith` on the URL path.

```typescript
loadflux({
  excludeRoutes: [
    "/health",                  // exact match
    "/ready",                   // exact match
    "/documentation/*",         // excludes /documentation, /documentation/api, /documentation/v1/...
    "/.well-known/acme-challenge", // exact match
  ],
})
```

## Full example with all options

```typescript
app.use(loadflux({
  path: "/monitor",
  database: {
    adapter: "sqlite",
    connectionString: "./data/monitoring.db",
  },
  auth: {
    username: "admin",
    password: "secure-password",
  },
  collection: {
    systemInterval: 10000,     // collect system metrics every 10s
    aggregationWindow: 5000,   // flush request metrics every 5s
  },
  retention: {
    days: 30,                  // keep 30 days of data
    cronExpression: "0 3 * * *", // clean up at 3 AM
  },
  slowRequestThreshold: 1000, // flag requests > 1 second
  excludeRoutes: ["/health", "/ready", "/documentation/*"],
}));
```
