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
