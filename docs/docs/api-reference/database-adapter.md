---
sidebar_position: 2
---

# Database Adapter

LoadFlux uses a `DatabaseAdapter` interface to abstract database operations. This makes it possible to support multiple databases (SQLite, MongoDB) and allows advanced users to implement custom adapters.

## `DatabaseAdapter` interface

```typescript
interface DatabaseAdapter {
  // Lifecycle
  connect(): Promise<void>;
  close(): Promise<void>;

  // Inserts (fire-and-forget)
  insertSystemMetrics(metrics: SystemMetricRow): void;
  insertProcessMetrics(metrics: ProcessMetricRow): void;
  insertEndpointMetricsBatch(rows: EndpointMetricRow[]): void;
  insertError(error: ErrorLogRow): void;

  // Queries
  getSystemMetrics(range: TimeRange): Promise<SystemMetricRow[]>;
  getProcessMetrics(range: TimeRange): Promise<ProcessMetricRow[]>;
  getEndpointMetrics(range: TimeRange): Promise<EndpointMetricRow[]>;
  getTopEndpoints(
    metric: TopEndpointMetric,
    limit: number,
    range: TimeRange
  ): Promise<TopEndpointRow[]>;
  getSlowRequests(
    thresholdMs: number,
    range: TimeRange
  ): Promise<EndpointMetricRow[]>;
  getErrorLog(range: TimeRange): Promise<ErrorLogRow[]>;
  getStatusDistribution(range: TimeRange): Promise<StatusDistribution>;
  getOverview(range: TimeRange): Promise<OverviewMetrics>;

  // Maintenance
  deleteOlderThan(timestamp: number): void;

  // Settings (key-value store)
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): void;

  // Auth
  getUser(
    username: string
  ): Promise<{ username: string; password_hash: string } | null>;
  createUser(username: string, passwordHash: string): void;
  updateUserPassword(username: string, passwordHash: string): void;
}
```

## Built-in implementations

### SQLiteAdapter

- Uses `better-sqlite3` for synchronous, fast operations
- Prepared statements for all queries
- Batched transactions for insert operations
- Automatic schema migrations on `connect()`
- File-based storage at the configured path

### MongoDBAdapter

- Uses the official `mongodb` driver
- Collections: `system_metrics`, `process_metrics`, `endpoint_metrics`, `error_log`, `settings`, `auth`
- TTL indexes for automatic data expiration
- Aggregation pipelines for computed queries (top endpoints, overview)
- Bulk writes via `insertMany`

## Method details

### Lifecycle

- **`connect()`** — Initialize the database connection. For SQLite, this opens the file and runs migrations. For MongoDB, this connects to the server and creates indexes.
- **`close()`** — Close the database connection gracefully.

### Insert methods

Insert methods are synchronous (fire-and-forget). They don't return promises because:

- SQLite operations are synchronous by nature (`better-sqlite3`)
- MongoDB inserts are buffered and don't need to be awaited on the hot path

### Query methods

All query methods accept a `TimeRange` and return promises:

- **`getSystemMetrics(range)`** — System metrics within the time range, ordered by timestamp
- **`getProcessMetrics(range)`** — Process metrics within the time range
- **`getEndpointMetrics(range)`** — All endpoint aggregations within the time range
- **`getTopEndpoints(metric, limit, range)`** — Top N endpoints sorted by the given metric
- **`getSlowRequests(thresholdMs, range)`** — Endpoints with avg duration exceeding the threshold
- **`getErrorLog(range)`** — Individual error entries, newest first
- **`getStatusDistribution(range)`** — Summed status code counts (2xx, 3xx, 4xx, 5xx)
- **`getOverview(range)`** — Computed overview: total requests, errors, error rate, RPS, RPM, avg/p95/p99 latency

### Maintenance

- **`deleteOlderThan(timestamp)`** — Delete all records with `timestamp` before the given value. Called by the retention cron job.

### Settings

Key-value store for runtime configuration:

- **`getSetting(key)`** — Get a setting value by key
- **`setSetting(key, value)`** — Set a setting value

Used internally for `schema_version`, `hmac_secret`, `retention_days`, `slow_threshold`.

### Auth

- **`getUser(username)`** — Look up a user by username
- **`createUser(username, passwordHash)`** — Create a new user
- **`updateUserPassword(username, passwordHash)`** — Update an existing user's password hash
