---
sidebar_position: 3
---

# Real-Time Updates (SSE)

LoadFlux uses **Server-Sent Events (SSE)** to push real-time data to the dashboard. No WebSocket dependency needed.

## How it works

1. When the dashboard opens, it connects to the SSE endpoint at `{path}/api/sse`
2. The server pushes a **snapshot** every 2 seconds to all connected clients
3. The dashboard updates gauges, charts, and statistics in real-time
4. If the connection drops, the browser automatically reconnects (built-in SSE behavior)

## Snapshot payload

Each SSE message contains a `DashboardSnapshot`:

```typescript
interface DashboardSnapshot {
  system: {
    cpu_percent: number;
    mem_percent: number;
    mem_used: number;
    mem_total: number;
    disk_percent: number | null;
    net_rx_bytes: number;
    net_tx_bytes: number;
  };
  process: {
    heap_used: number;
    heap_total: number;
    event_loop_avg_ms: number;
    event_loop_max_ms: number;
    gc_pause_ms: number;
    uptime_seconds: number;
  };
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
  };
  timestamp: number;
}
```

## Dashboard pages using SSE

- **Dashboard (Home)** — All stat cards and top endpoint tables
- **App Metrics** — Uptime counter updates in real-time

Other pages (System, Endpoints, Errors) fetch data from the REST API using the selected time range.

## SSE vs REST API

| | SSE | REST API |
|---|---|---|
| **Update frequency** | Every 2 seconds | On-demand (page load, time range change) |
| **Data** | Current snapshot only | Historical time-series data |
| **Used by** | Dashboard home, App Metrics uptime | System, Endpoints, Errors, Settings pages |
| **Connection** | Persistent | Request/response |

## Connection count

The number of active SSE connections is visible in the server info bar on the dashboard home page. This helps you understand how many users are viewing the dashboard.

## Resource usage

SSE connections are lightweight:

- Each connection is a standard HTTP response held open
- The server pushes ~1-2 KB of JSON every 2 seconds per client
- Connections are cleaned up automatically when clients disconnect
- The SSE interval timer uses `unref()` so it won't prevent Node.js from exiting
