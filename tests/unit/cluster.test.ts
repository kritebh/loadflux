import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveConfig } from "../../src/config.js";
import { resolveInstanceId } from "../../src/core/instance-id.js";
import { MetricsStore } from "../../src/core/metrics-store.js";
import { SQLiteAdapter } from "../../src/db/sqlite.js";
import type { ResolvedConfig } from "../../src/types.js";
import { tmpDbPath, cleanupSqliteDb } from "../helpers/db.js";

function clusterConfig(dbPath: string, instanceId: string): ResolvedConfig {
  return {
    ...resolveConfig({ database: { connectionString: dbPath } }),
    cluster: { enabled: true, instanceId },
  };
}

describe("cluster config", () => {
  it("throws when cluster mode is enabled with sqlite", () => {
    expect(() =>
      resolveConfig({
        cluster: { enabled: true },
        database: { adapter: "sqlite", connectionString: "./test.db" },
      }),
    ).toThrow("cluster mode requires the mongodb database adapter");
  });

  it("resolves instance id from env and config", () => {
    const prev = process.env.LOADFLUX_INSTANCE_ID;
    process.env.LOADFLUX_INSTANCE_ID = "task-123";
    try {
      expect(resolveInstanceId()).toBe("task-123");
      expect(resolveInstanceId("custom")).toBe("custom");
    } finally {
      if (prev !== undefined) process.env.LOADFLUX_INSTANCE_ID = prev;
      else delete process.env.LOADFLUX_INSTANCE_ID;
    }
  });
});

describe("cluster metrics (SQLite shared DB simulation)", () => {
  let dbPath: string;
  let db: SQLiteAdapter;

  beforeEach(async () => {
    dbPath = tmpDbPath("loadflux-cluster-test");
    db = new SQLiteAdapter(dbPath);
    await db.connect();
  });

  afterEach(async () => {
    await db.close();
    cleanupSqliteDb(dbPath);
  });

  it("aggregates live overview across instances", async () => {
    const now = Date.now();
    db.insertEndpointMetricsBatch([
      {
        timestamp: now - 1000,
        instance_id: "a",
        method: "GET",
        path: "/api/a",
        request_count: 10,
        error_count: 1,
        total_duration: 100,
        min_duration: 5,
        max_duration: 20,
        avg_duration: 10,
        p50_duration: 10,
        p90_duration: 15,
        p95_duration: 18,
        p99_duration: 20,
        total_res_bytes: 1000,
        status_2xx: 9,
        status_3xx: 0,
        status_4xx: 1,
        status_5xx: 0,
      },
      {
        timestamp: now - 1000,
        instance_id: "b",
        method: "GET",
        path: "/api/b",
        request_count: 6,
        error_count: 0,
        total_duration: 60,
        min_duration: 5,
        max_duration: 20,
        avg_duration: 10,
        p50_duration: 10,
        p90_duration: 15,
        p95_duration: 18,
        p99_duration: 20,
        total_res_bytes: 600,
        status_2xx: 6,
        status_3xx: 0,
        status_4xx: 0,
        status_5xx: 0,
      },
    ]);

    const live = await db.getLiveOverview(now, 5000);
    expect(live.total_requests).toBe(16);
    expect(live.total_errors).toBe(1);
    expect(live.rpm).toBe(16);

    const lifetime = await db.getLifetimeTotals();
    expect(lifetime.total_requests).toBe(16);
    expect(lifetime.total_errors).toBe(1);
  });

  it("lifetime totals include rows outside the live 1-minute window", async () => {
    const now = Date.now();
    db.insertEndpointMetricsBatch([
      {
        timestamp: now - 120_000,
        instance_id: "a",
        method: "GET",
        path: "/old",
        request_count: 100,
        error_count: 5,
        total_duration: 1000,
        min_duration: 5,
        max_duration: 20,
        avg_duration: 10,
        p50_duration: 10,
        p90_duration: 15,
        p95_duration: 18,
        p99_duration: 20,
        total_res_bytes: 1000,
        status_2xx: 95,
        status_3xx: 0,
        status_4xx: 5,
        status_5xx: 0,
      },
      {
        timestamp: now - 1000,
        instance_id: "b",
        method: "GET",
        path: "/new",
        request_count: 7,
        error_count: 1,
        total_duration: 70,
        min_duration: 5,
        max_duration: 20,
        avg_duration: 10,
        p50_duration: 10,
        p90_duration: 15,
        p95_duration: 18,
        p99_duration: 20,
        total_res_bytes: 700,
        status_2xx: 6,
        status_3xx: 0,
        status_4xx: 1,
        status_5xx: 0,
      },
    ]);

    const live = await db.getLiveOverview(now, 5000);
    expect(live.rpm).toBe(7);

    const lifetime = await db.getLifetimeTotals();
    expect(lifetime.total_requests).toBe(107);
    expect(lifetime.total_errors).toBe(6);

    const snapshot = await new MetricsStore(
      db,
      clusterConfig(dbPath, "reader"),
    ).getCurrentSnapshot();
    expect(snapshot.overview.total_requests).toBe(107);
    expect(snapshot.overview.rpm).toBe(7);
    expect(snapshot.overview.error_rate).toBeCloseTo((6 / 107) * 100, 1);
  });

  it("aggregates cluster system live metrics", async () => {
    const now = Date.now();
    db.insertSystemMetrics({
      timestamp: now - 1000,
      instance_id: "a",
      cpu_percent: 40,
      mem_total: 1_000_000_000,
      mem_used: 400_000_000,
      mem_percent: 40,
      disk_total: null,
      disk_used: null,
      disk_percent: null,
      net_rx_bytes: 1000,
      net_tx_bytes: 2000,
    });
    db.insertSystemMetrics({
      timestamp: now - 500,
      instance_id: "b",
      cpu_percent: 60,
      mem_total: 1_000_000_000,
      mem_used: 600_000_000,
      mem_percent: 60,
      disk_total: null,
      disk_used: null,
      disk_percent: null,
      net_rx_bytes: 3000,
      net_tx_bytes: 4000,
    });

    const cluster = await db.getClusterSystemLive(10_000);
    expect(cluster).not.toBeNull();
    expect(cluster!.cpu_percent).toBe(50);
    expect(cluster!.mem_used).toBe(1_000_000_000);
    expect(cluster!.net_rx_bytes).toBe(4000);
    expect(cluster!.net_tx_bytes).toBe(6000);
  });

  it("lists distinct instances in a range", async () => {
    const now = Date.now();
    db.insertSystemMetrics({
      timestamp: now,
      instance_id: "alpha",
      cpu_percent: 10,
      mem_total: 1,
      mem_used: 1,
      mem_percent: 100,
      disk_total: null,
      disk_used: null,
      disk_percent: null,
      net_rx_bytes: 0,
      net_tx_bytes: 0,
    });
    db.insertSystemMetrics({
      timestamp: now,
      instance_id: "beta",
      cpu_percent: 10,
      mem_total: 1,
      mem_used: 1,
      mem_percent: 100,
      disk_total: null,
      disk_used: null,
      disk_percent: null,
      net_rx_bytes: 0,
      net_tx_bytes: 0,
    });

    const instances = await db.listInstances({ from: now - 1000, to: now + 1000 });
    expect(instances).toEqual(["alpha", "beta"]);
  });

  it("returns the same cluster snapshot from two MetricsStore readers", async () => {
    const now = Date.now();
    db.insertEndpointMetricsBatch([
      {
        timestamp: now,
        instance_id: "writer-a",
        method: "GET",
        path: "/a",
        request_count: 4,
        error_count: 0,
        total_duration: 40,
        min_duration: 10,
        max_duration: 10,
        avg_duration: 10,
        p50_duration: 10,
        p90_duration: 10,
        p95_duration: 10,
        p99_duration: 10,
        total_res_bytes: 200,
        status_2xx: 4,
        status_3xx: 0,
        status_4xx: 0,
        status_5xx: 0,
      },
      {
        timestamp: now,
        instance_id: "writer-b",
        method: "GET",
        path: "/b",
        request_count: 2,
        error_count: 2,
        total_duration: 40,
        min_duration: 20,
        max_duration: 20,
        avg_duration: 20,
        p50_duration: 20,
        p90_duration: 20,
        p95_duration: 20,
        p99_duration: 20,
        total_res_bytes: 100,
        status_2xx: 0,
        status_3xx: 0,
        status_4xx: 0,
        status_5xx: 2,
      },
    ]);

    const snapshotA = await new MetricsStore(
      db,
      clusterConfig(dbPath, "writer-a"),
    ).getCurrentSnapshot();
    const snapshotB = await new MetricsStore(
      db,
      clusterConfig(dbPath, "writer-b"),
    ).getCurrentSnapshot();

    expect(snapshotA.overview.total_requests).toBe(6);
    expect(snapshotB.overview.total_requests).toBe(6);
    expect(snapshotA.server.cluster_enabled).toBe(true);
    expect(snapshotB.server.cluster_enabled).toBe(true);
  });

  it("increments lifetime counters on endpoint inserts without rescanning", async () => {
    const now = Date.now();
    expect(await db.getLifetimeTotals()).toEqual({
      total_requests: 0,
      total_errors: 0,
    });

    db.insertEndpointMetricsBatch([
      {
        timestamp: now,
        instance_id: "a",
        method: "GET",
        path: "/x",
        request_count: 3,
        error_count: 1,
        total_duration: 30,
        min_duration: 10,
        max_duration: 10,
        avg_duration: 10,
        p50_duration: 10,
        p90_duration: 10,
        p95_duration: 10,
        p99_duration: 10,
        total_res_bytes: 100,
        status_2xx: 2,
        status_3xx: 0,
        status_4xx: 1,
        status_5xx: 0,
      },
    ]);
    expect(await db.getLifetimeTotals()).toEqual({
      total_requests: 3,
      total_errors: 1,
    });

    db.incrementLifetimeTotals(2, 0);
    expect(await db.getLifetimeTotals()).toEqual({
      total_requests: 5,
      total_errors: 1,
    });
  });

  it("filters system metrics by instance_id equality", async () => {
    const now = Date.now();
    db.insertSystemMetrics({
      timestamp: now,
      instance_id: "only-a",
      cpu_percent: 11,
      mem_total: 1,
      mem_used: 1,
      mem_percent: 100,
      disk_total: null,
      disk_used: null,
      disk_percent: null,
      net_rx_bytes: 0,
      net_tx_bytes: 0,
    });
    db.insertSystemMetrics({
      timestamp: now,
      instance_id: "only-b",
      cpu_percent: 22,
      mem_total: 1,
      mem_used: 1,
      mem_percent: 100,
      disk_total: null,
      disk_used: null,
      disk_percent: null,
      net_rx_bytes: 0,
      net_tx_bytes: 0,
    });

    const rows = await db.getSystemMetrics(
      { from: now - 1000, to: now + 1000 },
      undefined,
      { instanceId: "only-a" },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].cpu_percent).toBe(11);
  });

  it("counts instances from endpoint metrics only", async () => {
    const now = Date.now();
    db.insertSystemMetrics({
      timestamp: now,
      instance_id: "sys-only",
      cpu_percent: 1,
      mem_total: 1,
      mem_used: 1,
      mem_percent: 100,
      disk_total: null,
      disk_used: null,
      disk_percent: null,
      net_rx_bytes: 0,
      net_tx_bytes: 0,
    });
    db.insertEndpointMetricsBatch([
      {
        timestamp: now,
        instance_id: "ep-a",
        method: "GET",
        path: "/",
        request_count: 1,
        error_count: 0,
        total_duration: 1,
        min_duration: 1,
        max_duration: 1,
        avg_duration: 1,
        p50_duration: 1,
        p90_duration: 1,
        p95_duration: 1,
        p99_duration: 1,
        total_res_bytes: 1,
        status_2xx: 1,
        status_3xx: 0,
        status_4xx: 0,
        status_5xx: 0,
      },
      {
        timestamp: now,
        instance_id: "ep-b",
        method: "GET",
        path: "/",
        request_count: 1,
        error_count: 0,
        total_duration: 1,
        min_duration: 1,
        max_duration: 1,
        avg_duration: 1,
        p50_duration: 1,
        p90_duration: 1,
        p95_duration: 1,
        p99_duration: 1,
        total_res_bytes: 1,
        status_2xx: 1,
        status_3xx: 0,
        status_4xx: 0,
        status_5xx: 0,
      },
    ]);

    expect(await db.countInstances({ from: now - 1000, to: now + 1000 })).toBe(
      2,
    );
    const listed = await db.listInstances({ from: now - 1000, to: now + 1000 });
    expect(listed).toEqual(["ep-a", "ep-b", "sys-only"]);
  });
});
