---
sidebar_position: 1
---

# Types

LoadFlux exports its configuration and database adapter types for TypeScript consumers.

## Exported types

```typescript
import type { LoadFluxConfig, DatabaseAdapter } from "loadflux";
```

## `LoadFluxConfig`

The configuration object passed to `loadflux()` or `loadfluxFastify()`.

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
  disableOnLocalhost?: boolean;
  listenHost?: string;
  trustProxy?: boolean;
  cluster?: {
    enabled?: boolean;
    instanceId?: string;
  };
}
```

See [Configuration Options](/docs/configuration/options) for detailed descriptions.

## Internal types

These types are used internally and documented here for reference.

### `RequestRecord`

Raw request data before aggregation:

```typescript
interface RequestRecord {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  responseBytes: number;
  timestamp: number;
  errorMessage?: string;
  stackTrace?: string;
}
```

### `SystemMetricRow`

One row per collection interval:

```typescript
interface SystemMetricRow {
  instance_id?: string;
  timestamp: number;
  cpu_percent: number;
  mem_total: number;
  mem_used: number;
  mem_percent: number;
  disk_total: number | null;
  disk_used: number | null;
  disk_percent: number | null;
  net_rx_bytes: number;
  net_tx_bytes: number;
}
```

### `ProcessMetricRow`

```typescript
interface ProcessMetricRow {
  instance_id?: string;
  timestamp: number;
  heap_used: number;
  heap_total: number;
  external_mem: number;
  event_loop_avg_ms: number;
  event_loop_max_ms: number;
  gc_pause_ms: number;
  uptime_seconds: number;
}
```

### `EndpointMetricRow`

Aggregated per route per flush window:

```typescript
interface EndpointMetricRow {
  instance_id?: string;
  timestamp: number;
  method: string;
  path: string;
  request_count: number;
  error_count: number;
  total_duration: number;
  min_duration: number;
  max_duration: number;
  avg_duration: number;
  p50_duration: number;
  p90_duration: number;
  p95_duration: number;
  p99_duration: number;
  total_res_bytes: number;
  status_2xx: number;
  status_3xx: number;
  status_4xx: number;
  status_5xx: number;
}
```

### `ErrorLogRow`

Individual error entries:

```typescript
interface ErrorLogRow {
  instance_id?: string;
  timestamp: number;
  method: string;
  path: string;
  status_code: number;
  error_msg: string | null;
  stack_trace: string | null;
  duration_ms: number;
}
```

### `OverviewMetrics`

Aggregated overview for a time range:

```typescript
interface OverviewMetrics {
  total_requests: number;
  total_errors: number;
  error_rate: number;
  avg_duration: number;
  p95_duration: number;
  p99_duration: number;
  rps: number;
  rpm: number;
}
```

### `TimeRange`

```typescript
interface TimeRange {
  from: number; // Unix timestamp (ms)
  to: number;   // Unix timestamp (ms)
}
```

### `MetricsQueryOptions`

Used by system/process queries and the REST API (`instance` query param):

```typescript
interface MetricsQueryOptions {
  instanceId?: string;
  clusterAggregate?: boolean;
}
```

### `QueryFilter`

```typescript
interface QueryFilter {
  search?: string;
  status?: string;
}
```

### `PaginationParams` / `PaginatedResult<T>`

```typescript
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
```

### `LiveOverviewMetrics` / `LifetimeTotals`

```typescript
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
```

### `DashboardSnapshot`

Shape of SSE messages and `GET /api/snapshot` (not exported from the package; documented for integrators):

```typescript
interface DashboardSnapshot {
  system: { /* cpu, mem, disk, net fields */ };
  process: { /* heap, event loop, gc, uptime */ };
  overview: {
    rps: number;
    rpm: number;
    total_requests: number;
    error_rate: number;
    avg_duration: number;
    p95_duration: number;
    p99_duration: number;
  };
  endpoints: {
    top_by_requests: TopEndpointRow[];
    top_by_latency: TopEndpointRow[];
    top_by_errors: TopEndpointRow[];
    status: StatusDistribution;
  };
  server: {
    node_version: string;
    platform: string;
    pid: number;
    sse_connections: number;
    instance_id?: string;
    cluster_instances?: number;
    cluster_enabled?: boolean;
  };
  timestamp: number;
}
```

See [Real-Time Updates (SSE)](/docs/guides/sse-real-time) for field semantics.

### `TopEndpointRow`

```typescript
interface TopEndpointRow {
  method: string;
  path: string;
  value: number;
}
```

### `StatusDistribution`

```typescript
interface StatusDistribution {
  status_2xx: number;
  status_3xx: number;
  status_4xx: number;
  status_5xx: number;
}
```

### `TopEndpointMetric`

Valid metrics for the top endpoints query:

```typescript
type TopEndpointMetric =
  | "request_count"
  | "avg_duration"
  | "p95_duration"
  | "error_rate"
  | "total_res_bytes";
```
