import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MetricsStore } from "../../src/core/metrics-store.js";
import { resolveConfig } from "../../src/config.js";
import { SQLiteAdapter } from "../../src/db/sqlite.js";
import { tmpDbPath, cleanupSqliteDb } from "../helpers/db.js";

describe("MetricsStore", () => {
  let db: SQLiteAdapter;
  let dbPath: string;
  let store: MetricsStore;

  beforeEach(async () => {
    dbPath = tmpDbPath("loadflux-metrics-store-test");
    db = new SQLiteAdapter(dbPath);
    await db.connect();
    store = new MetricsStore(
      db,
      resolveConfig({
        database: { connectionString: dbPath },
        collection: { systemInterval: 60_000, aggregationWindow: 60_000 },
      }),
    );
  });

  afterEach(async () => {
    store.stop();
    await db.close();
    cleanupSqliteDb(dbPath);
  });

  it("tracks RPS and RPM with second buckets", async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      store.recordRequest({
        method: "GET",
        path: "/api/test",
        statusCode: 200,
        durationMs: 10,
        responseBytes: 100,
        timestamp: now + i,
      });
    }

    const snapshot = await store.getCurrentSnapshot();
    expect(snapshot.overview.rps).toBe(5);
    expect(snapshot.overview.rpm).toBe(5);
    expect(snapshot.overview.total_requests).toBe(5);
  });

  it("expires buckets older than 60 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));

    store.recordRequest({
      method: "GET",
      path: "/old",
      statusCode: 200,
      durationMs: 10,
      responseBytes: 100,
      timestamp: Date.now(),
    });

    vi.advanceTimersByTime(65_000);

    store.recordRequest({
      method: "GET",
      path: "/new",
      statusCode: 200,
      durationMs: 10,
      responseBytes: 100,
      timestamp: Date.now(),
    });
    store.recordRequest({
      method: "GET",
      path: "/new",
      statusCode: 200,
      durationMs: 10,
      responseBytes: 100,
      timestamp: Date.now(),
    });

    const snapshot = await store.getCurrentSnapshot();
    expect(snapshot.overview.rpm).toBe(2);
    expect(snapshot.overview.total_requests).toBe(3);

    vi.useRealTimers();
  });

  it("includes metrics_meta in snapshot from stored endpoint rows", async () => {
    const oldest = Date.now() - 120_000;
    db.insertEndpointMetricsBatch([
      {
        timestamp: oldest,
        method: "GET",
        path: "/api/history",
        request_count: 10,
        error_count: 1,
        total_duration: 100,
        min_duration: 5,
        max_duration: 20,
        avg_duration: 10,
        p50_duration: 10,
        p90_duration: 15,
        p95_duration: 18,
        p99_duration: 19,
        total_res_bytes: 1000,
        status_2xx: 9,
        status_3xx: 0,
        status_4xx: 0,
        status_5xx: 1,
      },
    ]);
    await db.setSetting("retention_days", "45");

    const snapshot = await store.getCurrentSnapshot();
    expect(snapshot.metrics_meta.oldest_endpoint_metric_ms).toBe(oldest);
    expect(snapshot.metrics_meta.monitoring_since_ms).toBe(oldest);
    expect(snapshot.metrics_meta.retention_days).toBe(45);
  });

  it("computes daily_rps from endpoint metrics in the last 24 hours", async () => {
    const now = Date.now();
    const dayMs = 86_400_000;
    db.insertEndpointMetricsBatch([
      {
        timestamp: now - 60_000,
        method: "GET",
        path: "/api/daily",
        request_count: 86_400,
        error_count: 0,
        total_duration: 1000,
        min_duration: 1,
        max_duration: 10,
        avg_duration: 5,
        p50_duration: 5,
        p90_duration: 8,
        p95_duration: 9,
        p99_duration: 10,
        total_res_bytes: 0,
        status_2xx: 86_400,
        status_3xx: 0,
        status_4xx: 0,
        status_5xx: 0,
      },
    ]);

    const snapshot = await store.getCurrentSnapshot();
    const expected = 86_400 / (dayMs / 1000);
    expect(snapshot.overview.daily_rps).toBeCloseTo(expected, 5);
  });
});
