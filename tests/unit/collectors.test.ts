import { describe, it, expect } from "vitest";
import { collectSystemMetrics } from "../../src/core/system-collector.js";
import {
  collectProcessMetrics,
  startProcessMonitoring,
  stopProcessMonitoring,
} from "../../src/core/process-collector.js";

describe("SystemCollector", () => {
  it("returns valid system metrics", () => {
    const metrics = collectSystemMetrics();
    expect(metrics.timestamp).toBeGreaterThan(0);
    expect(metrics.cpu_percent).toBeGreaterThanOrEqual(0);
    expect(metrics.mem_total).toBeGreaterThan(0);
    expect(metrics.mem_used).toBeGreaterThan(0);
    expect(metrics.mem_percent).toBeGreaterThan(0);
    expect(metrics.mem_percent).toBeLessThanOrEqual(100);
  });

  it("returns disk metrics (may be null on some systems)", () => {
    const metrics = collectSystemMetrics();
    // disk_percent can be null if statfs is unavailable
    if (metrics.disk_percent !== null) {
      expect(metrics.disk_percent).toBeGreaterThanOrEqual(0);
      expect(metrics.disk_percent).toBeLessThanOrEqual(100);
    }
  });

  it("returns network bytes >= 0", () => {
    const metrics = collectSystemMetrics();
    expect(metrics.net_rx_bytes).toBeGreaterThanOrEqual(0);
    expect(metrics.net_tx_bytes).toBeGreaterThanOrEqual(0);
  });
});

describe("ProcessCollector", () => {
  it("returns valid process metrics without monitoring started", () => {
    const metrics = collectProcessMetrics();
    expect(metrics.timestamp).toBeGreaterThan(0);
    expect(metrics.heap_used).toBeGreaterThan(0);
    expect(metrics.heap_total).toBeGreaterThan(0);
    expect(metrics.external_mem).toBeGreaterThanOrEqual(0);
    expect(metrics.uptime_seconds).toBeGreaterThan(0);
    expect(metrics.event_loop_avg_ms).toBeGreaterThanOrEqual(0);
    expect(metrics.event_loop_max_ms).toBeGreaterThanOrEqual(0);
    expect(metrics.gc_pause_ms).toBeGreaterThanOrEqual(0);
  });

  it("returns metrics with monitoring started", () => {
    startProcessMonitoring();
    const metrics = collectProcessMetrics();
    expect(metrics.heap_used).toBeGreaterThan(0);
    expect(metrics.uptime_seconds).toBeGreaterThan(0);
    stopProcessMonitoring();
  });
});
