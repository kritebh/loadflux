import type {
  SystemMetricRow,
  EndpointMetricRow,
  ErrorLogRow,
  ProcessMetricRow,
} from "../../src/types.js";

export function makeSystemRow(ts: number, idx: number): SystemMetricRow {
  return {
    timestamp: ts,
    cpu_percent: 10 + (idx % 80),
    mem_total: 16_000_000_000,
    mem_used: 4_000_000_000 + idx * 1_000_000,
    mem_percent: 25 + (idx % 50),
    disk_total: 500_000_000_000,
    disk_used: 200_000_000_000,
    disk_percent: 40,
    net_rx_bytes: idx * 100,
    net_tx_bytes: idx * 50,
  };
}

export function makeProcessRow(ts: number, idx: number): ProcessMetricRow {
  return {
    timestamp: ts,
    heap_used: 30_000_000 + idx * 10_000,
    heap_total: 100_000_000,
    external_mem: 5_000_000,
    event_loop_avg_ms: 1 + (idx % 10) * 0.5,
    event_loop_max_ms: 5 + (idx % 20),
    gc_pause_ms: 0.1 * (idx % 5),
    uptime_seconds: idx * 3600,
  };
}

export function makeEndpointRow(
  ts: number,
  idx: number,
  method: string,
  routePath: string,
): EndpointMetricRow {
  const base = idx + 1;
  return {
    timestamp: ts,
    method,
    path: routePath,
    request_count: base * 10,
    error_count: base % 5 === 0 ? base : 0,
    total_duration: base * 50,
    min_duration: 5,
    max_duration: 100 + base,
    avg_duration: 20 + (base % 30),
    p50_duration: 18 + (base % 25),
    p90_duration: 60 + (base % 40),
    p95_duration: 80 + (base % 20),
    p99_duration: 95 + (base % 10),
    total_res_bytes: base * 500,
    status_2xx: base * 8,
    status_3xx: 0,
    status_4xx: base % 5 === 0 ? base : 0,
    status_5xx: base % 10 === 0 ? 1 : 0,
  };
}

export function makeErrorRow(ts: number, idx: number): ErrorLogRow {
  return {
    timestamp: ts,
    method: "GET",
    path: "/api/fail",
    status_code: idx % 2 === 0 ? 500 : 400,
    error_msg: `Error at index ${idx}`,
    stack_trace: null,
    duration_ms: 50 + idx,
  };
}
