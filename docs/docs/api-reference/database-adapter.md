---
sidebar_position: 2
---

# Database Adapter

LoadFlux uses a `DatabaseAdapter` interface to abstract database operations. This makes it possible to support multiple databases (SQLite, MongoDB) and allows advanced users to implement custom adapters.

The canonical definition lives in `src/types.ts`. Only **`LoadFluxConfig`** and **`DatabaseAdapter`** are re-exported from the `loadflux` package.

## `DatabaseAdapter` interface

```typescript
interface MetricsQueryOptions {
  /** Filter to a single instance; omit for all instances. */
  instanceId?: string;
  /** Aggregate metrics across all instances (cluster view). */
  clusterAggregate?: boolean;
}

interface QueryFilter {
  search?: string;
  status?: string;
}

interface PaginationParams {
  page: number;
  limit: number;
}

interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

interface LiveOverviewMetrics {
  rps: number;
  rpm: number;
  total_requests: number;
  total_errors: number;
  error_rate: number;
}

interface LifetimeTotals {
  total_requests: number;
  total_errors: number;
}

interface DatabaseAdapter {
  connect(): Promise<void>;
  close(): Promise<void>;

  // Inserts (fire-and-forget for both adapters)
  insertSystemMetrics(metrics: SystemMetricRow): void;
  insertProcessMetrics(metrics: ProcessMetricRow): void;
  insertEndpointMetricsBatch(rows: EndpointMetricRow[]): void;
  insertError(error: ErrorLogRow): void;
  insertErrorsBatch(errors: ErrorLogRow[]): void;
  insertSystemAndProcessMetrics(
    system: SystemMetricRow,
    process: ProcessMetricRow,
  ): void;

  getSystemMetrics(
    range: TimeRange,
    maxPoints?: number,
    options?: MetricsQueryOptions,
  ): Promise<SystemMetricRow[]>;
  getProcessMetrics(
    range: TimeRange,
    maxPoints?: number,
    options?: MetricsQueryOptions,
  ): Promise<ProcessMetricRow[]>;
  getLiveOverview(now: number): Promise<LiveOverviewMetrics>;
  getLifetimeTotals(): Promise<LifetimeTotals>;
  incrementLifetimeTotals(requests: number, errors: number): void;
  getClusterSystemLive(lookbackMs: number): Promise<SystemMetricRow | null>;
  getClusterProcessLive(lookbackMs: number): Promise<ProcessMetricRow | null>;
  listInstances(range: TimeRange): Promise<string[]>;
  countInstances(range: TimeRange): Promise<number>;
  getEndpointMetrics(
    range: TimeRange,
    filter?: QueryFilter,
  ): Promise<EndpointMetricRow[]>;
  getTopEndpoints(
    metric: TopEndpointMetric,
    limit: number,
    range: TimeRange,
    filter?: QueryFilter,
  ): Promise<TopEndpointRow[]>;
  getSlowRequests(
    thresholdMs: number,
    range: TimeRange,
    filter?: QueryFilter,
  ): Promise<EndpointMetricRow[]>;
  getErrorLog(range: TimeRange, filter?: QueryFilter): Promise<ErrorLogRow[]>;
  getErrorStatusCodes(range: TimeRange): Promise<number[]>;
  getStatusDistribution(range: TimeRange): Promise<StatusDistribution>;
  getOverview(range: TimeRange): Promise<OverviewMetrics>;

  getSystemMetricsPaginated(
    range: TimeRange,
    pagination: PaginationParams,
    maxPoints?: number,
    options?: MetricsQueryOptions,
  ): Promise<PaginatedResult<SystemMetricRow>>;
  getProcessMetricsPaginated(
    range: TimeRange,
    pagination: PaginationParams,
    maxPoints?: number,
    options?: MetricsQueryOptions,
  ): Promise<PaginatedResult<ProcessMetricRow>>;
  getEndpointMetricsPaginated(
    range: TimeRange,
    pagination: PaginationParams,
    filter?: QueryFilter,
  ): Promise<PaginatedResult<EndpointMetricRow>>;
  getSlowRequestsPaginated(
    thresholdMs: number,
    range: TimeRange,
    pagination: PaginationParams,
    filter?: QueryFilter,
  ): Promise<PaginatedResult<EndpointMetricRow>>;
  getErrorLogPaginated(
    range: TimeRange,
    pagination: PaginationParams,
    filter?: QueryFilter,
  ): Promise<PaginatedResult<ErrorLogRow>>;

  deleteOlderThan(timestamp: number): void;

  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): void;

  getUser(
    username: string,
  ): Promise<{ username: string; password_hash: string } | null>;
  hasAnyUser(): Promise<boolean>;
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
- Metric rows include optional `instance_id` (used when cluster mode tags writes)

### MongoDBAdapter

- Uses the official `mongodb` driver (peer dependency `>= 5`)
- Collections: `system_metrics`, `process_metrics`, `endpoint_metrics`, `error_log`, `settings`, `auth`
- Retention uses the same cron-driven `deleteOlderThan` as SQLite (not TTL indexes)
- Aggregation pipelines for computed queries (top endpoints, overview, cluster rollups)
- Bulk writes via `insertMany`; writes on the hot path are async (`fireAndForget`)

## Method details

### Lifecycle

- **`connect()`** — Initialize the database connection. For SQLite, this opens the file and runs migrations. For MongoDB, this connects to the server and creates indexes.
- **`close()`** — Close the database connection gracefully.

### Insert methods

Insert methods are synchronous (fire-and-forget). They don't return promises because:

- SQLite operations are synchronous by nature (`better-sqlite3`)
- MongoDB inserts are scheduled asynchronously and don't block the request path

`insertEndpointMetricsBatch` also calls **`incrementLifetimeTotals`** after persisting rows (both adapters).

### Live vs historical metrics

- **`getLiveOverview`** — Short-window RPS/RPM and related live fields used internally before the dashboard snapshot is built.
- **`getLifetimeTotals` / `incrementLifetimeTotals`** — O(1) counters for **Total Requests** and errors on the live dashboard. Seeded once from existing `endpoint_metrics`, then incremented on each flush. **Not** reduced when retention deletes old rows.
- **`getClusterSystemLive` / `getClusterProcessLive`** — Latest sample per `instance_id`, then aggregated (cluster mode).

### Time-series queries

- **`getSystemMetrics` / `getProcessMetrics`** — Optional **`maxPoints`** downsamples wide ranges server-side.
- **`MetricsQueryOptions`** — Pass **`instanceId`** for one replica, or **`clusterAggregate: true`** for a cluster roll-up (the HTTP API sets this automatically when `cluster.enabled` and `instance` is omitted).

### List and filter queries

- **`getEndpointMetrics`**, **`getTopEndpoints`**, **`getSlowRequests`**, **`getErrorLog`** — Optional **`QueryFilter`**: `search` (substring on path/method/message) and `status` (errors only).
- **`getErrorStatusCodes`** — Distinct HTTP status codes in the error log for a range (powers the Errors page status dropdown).
- **`listInstances` / `countInstances`** — Distinct `instance_id` values in a time range.

### Paginated queries

When the REST API receives `page`, list endpoints return **`PaginatedResult`** (`data` + `pagination`). Default `limit` is 200, max 1000.

### Maintenance

- **`deleteOlderThan(timestamp)`** — Delete all metric/error rows with `timestamp` &lt; cutoff. Invoked by the retention cron for **both** SQLite and MongoDB.

### Settings

Key-value store for runtime configuration:

- **`getSetting(key)`** / **`setSetting(key, value)`**

Used internally for `schema_version`, `hmac_secret`, `retention_days`, `slow_threshold`, and lifetime counter keys (`lifetime_total_requests`, `lifetime_total_errors`, `lifetime_totals_seeded`).

### Auth

- **`getUser(username)`** — Look up a user by username
- **`hasAnyUser()`** — Whether auth has been configured
- **`createUser(username, passwordHash)`** — Create a new user
- **`updateUserPassword(username, passwordHash)`** — Update an existing user's password hash

See [REST API](/docs/api-reference/rest-api) for how the dashboard calls these via HTTP.
